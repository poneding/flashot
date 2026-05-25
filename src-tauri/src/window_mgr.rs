use crate::scroll_stitch::ScrollStitcher;
use crate::types::FrozenFrame;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Active capture session. While `Some(_)`, the overlay is showing.
/// Drop guarantees `end_capture` runs (RAII invariant from spec §6.4).
#[derive(Default)]
pub struct WindowMgr {
    inner: Mutex<Inner>,
    /// Optional OCR chrome window registered for the current session. Closed
    /// automatically when the session ends so a stale window cannot survive
    /// across captures.
    ocr_chrome: std::sync::Mutex<Option<WebviewWindow>>,
}

#[derive(Default)]
struct Inner {
    /// Frozen frames keyed by monitor_id, alive only during a session.
    frames: HashMap<u32, FrozenFrame>,
    in_session: bool,
    scroll: Option<ScrollState>,
}

#[allow(dead_code)] // `monitor_id`/`rect` are recorded for future routing/debug use
pub(crate) struct ScrollState {
    pub monitor_id: u32,
    pub rect: crate::types::Rect, // physical px
    pub stitcher: Arc<tokio::sync::Mutex<ScrollStitcher>>,
    pub cancel: Arc<std::sync::atomic::AtomicBool>,
}

impl WindowMgr {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Begin a session and return a guard. Dropping the guard ends the session.
    pub fn begin(self: &Arc<Self>, app: AppHandle) -> SessionGuard {
        {
            let mut inner = self.inner.lock();
            inner.in_session = true;
            inner.frames.clear();
        }
        SessionGuard {
            mgr: self.clone(),
            app,
            ended: false,
        }
    }

    pub fn store_frame(&self, frame: FrozenFrame) {
        self.inner.lock().frames.insert(frame.monitor_id, frame);
    }

    pub fn frame(&self, monitor_id: u32) -> Option<FrozenFrame> {
        // Clone the rgba buffer out — caller cannot mutate the stored frame.
        // We only call this from the crop command path, which is rare (one click).
        self.inner
            .lock()
            .frames
            .get(&monitor_id)
            .map(|f| FrozenFrame {
                monitor_id: f.monitor_id,
                rgba: f.rgba.clone(),
                width: f.width,
                height: f.height,
                scale_factor: f.scale_factor,
                icc_profile: f.icc_profile.clone(),
            })
    }

    /// Crop the frozen frame for `monitor_id` to `rect` (logical px) and
    /// return the raw RGBA bytes plus the cropped dimensions (physical px).
    /// Returns `None` if no frame exists for that monitor or if the cropped
    /// rect falls outside the physical frame bounds.
    ///
    /// The same frame may be cropped multiple times in a single session (for
    /// example: crop once for save and once for OCR), so the underlying frame
    /// data is cloned rather than moved.
    pub fn crop_frame_rgba(
        &self,
        monitor_id: u32,
        rect: crate::types::Rect,
    ) -> Option<(Vec<u8>, u32, u32)> {
        let frame = self.frame(monitor_id)?;
        let cropped = crate::commands::crop_rgba(
            &frame.rgba,
            frame.width,
            frame.height,
            rect,
            frame.scale_factor,
        )?;
        Some((cropped.rgba, cropped.width, cropped.height))
    }

    /// Register an OCR chrome window for the active session. Any previously
    /// registered window is closed so each session can only own one chrome
    /// window at a time.
    pub fn set_ocr_chrome(&self, window: WebviewWindow) {
        let mut guard = self.ocr_chrome.lock().expect("ocr_chrome mutex");
        if let Some(prev) = guard.take() {
            let _ = prev.close();
        }
        *guard = Some(window);
    }

    /// Close and forget the OCR chrome window, if any. Called both explicitly
    /// when the OCR flow finishes and from `end_session` as part of the
    /// session-teardown RAII invariant.
    pub fn clear_ocr_chrome(&self) {
        let mut guard = self.ocr_chrome.lock().expect("ocr_chrome mutex");
        if let Some(prev) = guard.take() {
            let _ = prev.close();
        }
    }

    pub fn in_session(&self) -> bool {
        self.inner.lock().in_session
    }

    pub(crate) fn take_scroll(&self) -> Option<ScrollState> {
        self.inner.lock().scroll.take()
    }

    pub(crate) fn set_scroll(&self, s: ScrollState) {
        self.inner.lock().scroll = Some(s);
    }

    pub(crate) fn scroll_ref<R>(&self, f: impl FnOnce(&ScrollState) -> R) -> Option<R> {
        self.inner.lock().scroll.as_ref().map(f)
    }

    pub fn end_session(&self, app: &AppHandle) {
        self.clear_session_state();
        self.clear_ocr_chrome();
        self.hide_overlays(app);
        let _ = app.emit("capture:end", ());
    }

    fn clear_session_state(&self) {
        let mut inner = self.inner.lock();
        inner.frames.clear();
        if let Some(s) = inner.scroll.take() {
            s.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        inner.in_session = false;
    }

    fn end(&self, app: &AppHandle) {
        self.end_session(app);
    }

    fn hide_overlays(&self, app: &AppHandle) {
        for (_label, w) in app.webview_windows() {
            let label = w.label();
            if label.starts_with("overlay-chrome-") {
                // Chrome windows must be closed, not hidden — otherwise the next
                // scroll session reuses a stale hidden window. Their lifecycle
                // is bound to a single scroll session.
                let _ = w.close();
            } else if label.starts_with("overlay-") {
                #[cfg(target_os = "linux")]
                let _ = w.set_fullscreen(false);
                #[cfg(not(target_os = "linux"))]
                let _ = w.set_ignore_cursor_events(true);
                let _ = w.hide();
            }
        }
    }
}

pub struct SessionGuard {
    mgr: Arc<WindowMgr>,
    app: AppHandle,
    ended: bool,
}

impl SessionGuard {
    /// Explicitly end (used on success paths to keep call sites clear).
    pub fn end(mut self) {
        self.mgr.end(&self.app);
        self.ended = true;
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if !self.ended {
            self.mgr.end(&self.app);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::FrozenFrame;

    fn fake_frame(id: u32) -> FrozenFrame {
        FrozenFrame {
            monitor_id: id,
            rgba: vec![0; 4],
            width: 1,
            height: 1,
            scale_factor: 1.0,
            icc_profile: None,
        }
    }

    #[test]
    fn frames_round_trip_in_session() {
        let mgr = WindowMgr::new();
        // We can't call begin() in tests because it needs an AppHandle.
        // Test the storage directly via an internal pathway:
        mgr.inner.lock().in_session = true;
        mgr.store_frame(fake_frame(7));
        assert!(mgr.frame(7).is_some());
        assert!(mgr.frame(99).is_none());
    }

    #[test]
    fn explicit_end_clears_session_state() {
        let mgr = WindowMgr::new();
        mgr.inner.lock().in_session = true;
        mgr.store_frame(fake_frame(7));

        mgr.clear_session_state();

        assert!(!mgr.in_session());
        assert!(mgr.frame(7).is_none());
    }

    #[test]
    fn clear_session_state_cancels_active_scroll() {
        use crate::scroll_stitch::{ScrollStitcher, StitchConfig};
        use std::sync::atomic::{AtomicBool, Ordering};

        let mgr = WindowMgr::new();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let stitcher = std::sync::Arc::new(tokio::sync::Mutex::new(ScrollStitcher::new(
            2,
            2,
            vec![0; 16],
            StitchConfig::default(),
        )));
        mgr.set_scroll(super::ScrollState {
            monitor_id: 1,
            rect: crate::types::Rect {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
            stitcher,
            cancel: cancel.clone(),
        });

        mgr.clear_session_state();
        assert!(cancel.load(Ordering::SeqCst), "scroll cancel must be set");
        assert!(mgr.scroll_ref(|_| ()).is_none());
    }
}
