use crate::types::FrozenFrame;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Active capture session. While `Some(_)`, the overlay is showing.
/// Drop guarantees `end_capture` runs (RAII invariant from spec §6.4).
#[derive(Default)]
pub struct WindowMgr {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    /// Frozen frames keyed by monitor_id, alive only during a session.
    frames: HashMap<u32, FrozenFrame>,
    in_session: bool,
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
        SessionGuard { mgr: self.clone(), app, ended: false }
    }

    pub fn store_frame(&self, frame: FrozenFrame) {
        self.inner.lock().frames.insert(frame.monitor_id, frame);
    }

    pub fn frame(&self, monitor_id: u32) -> Option<FrozenFrame> {
        // Clone the rgba buffer out — caller cannot mutate the stored frame.
        // We only call this from the crop command path, which is rare (one click).
        self.inner.lock().frames.get(&monitor_id).map(|f| FrozenFrame {
            monitor_id: f.monitor_id,
            rgba: f.rgba.clone(),
            width: f.width,
            height: f.height,
            scale_factor: f.scale_factor,
        })
    }

    pub fn in_session(&self) -> bool {
        self.inner.lock().in_session
    }

    pub fn end_session(&self, app: &AppHandle) {
        self.clear_session_state();
        self.hide_overlays(app);
        let _ = app.emit("capture:end", ());
    }

    fn clear_session_state(&self) {
        let mut inner = self.inner.lock();
        inner.frames.clear();
        inner.in_session = false;
    }

    fn end(&self, app: &AppHandle) {
        self.end_session(app);
    }

    fn hide_overlays(&self, app: &AppHandle) {
        for (_label, w) in app.webview_windows() {
            if w.label().starts_with("overlay-") {
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
        FrozenFrame { monitor_id: id, rgba: vec![0; 4], width: 1, height: 1, scale_factor: 1.0 }
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
}
