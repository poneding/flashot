use crate::app_activation::PreviousFrontmostApp;
use crate::scroll_stitch::ScrollStitcher;
use crate::types::FrozenFrame;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct WindowMgr {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    frames: HashMap<u32, Arc<FrozenFrame>>,
    session_id: Option<String>,
    ending: bool,
    scroll: Option<ScrollState>,
    scroll_starting: bool,
    previous_app: PreviousFrontmostApp,
    capture_reveal: Option<CaptureRevealState>,
    text_inputs: HashSet<String>,
}

impl Inner {
    fn is_current(&self, session_id: &str) -> bool {
        !self.ending && self.session_id.as_deref() == Some(session_id)
    }
}

struct CaptureRevealState {
    revision: String,
    expected_monitor_ids: Vec<u32>,
    ready_monitor_ids: HashSet<u32>,
}

pub(crate) struct ScrollState {
    pub monitor_id: u32,
    pub logical_rect: crate::types::Rect,
    pub stitcher: Arc<tokio::sync::Mutex<ScrollStitcher>>,
    pub cancel: Arc<std::sync::atomic::AtomicBool>,
}

impl WindowMgr {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn reserve_session(&self, session_id: String) -> bool {
        let mut inner = self.inner.lock();
        if inner.session_id.is_some() {
            return false;
        }
        inner.session_id = Some(session_id);
        true
    }

    /// Reserve atomically. A stale guard can only clean up its own session.
    pub fn begin(self: &Arc<Self>, app: AppHandle, session_id: String) -> Option<SessionGuard> {
        if !self.reserve_session(session_id.clone()) {
            return None;
        }
        Some(SessionGuard {
            mgr: self.clone(),
            app,
            session_id,
            ended: false,
        })
    }

    pub fn session_id(&self) -> Option<String> {
        let inner = self.inner.lock();
        if inner.ending {
            None
        } else {
            inner.session_id.clone()
        }
    }

    pub fn is_current(&self, session_id: &str) -> bool {
        self.inner.lock().is_current(session_id)
    }

    pub fn in_session(&self) -> bool {
        self.inner.lock().session_id.is_some()
    }

    pub fn set_previous_app(&self, session_id: &str, app: PreviousFrontmostApp) {
        let mut inner = self.inner.lock();
        if inner.is_current(session_id) {
            inner.previous_app = app;
        }
    }

    pub fn store_frame(&self, session_id: &str, frame: FrozenFrame) -> bool {
        let mut inner = self.inner.lock();
        if !inner.is_current(session_id) {
            return false;
        }
        inner.frames.insert(frame.monitor_id, Arc::new(frame));
        true
    }

    pub fn frame(&self, session_id: &str, monitor_id: u32) -> Option<Arc<FrozenFrame>> {
        let inner = self.inner.lock();
        if !inner.is_current(session_id) {
            return None;
        }
        inner.frames.get(&monitor_id).cloned()
    }

    pub fn prepare_capture_reveal(&self, revision: String, monitor_ids: Vec<u32>) -> bool {
        let mut inner = self.inner.lock();
        if !inner.is_current(&revision) {
            return false;
        }
        inner.capture_reveal = Some(CaptureRevealState {
            revision,
            expected_monitor_ids: monitor_ids,
            ready_monitor_ids: HashSet::new(),
        });
        true
    }

    pub fn mark_capture_overlay_ready(&self, revision: &str, monitor_id: u32) -> Option<Vec<u32>> {
        let mut inner = self.inner.lock();
        if !inner.is_current(revision) {
            return None;
        }
        let reveal = inner.capture_reveal.as_mut()?;
        if reveal.revision != revision || !reveal.expected_monitor_ids.contains(&monitor_id) {
            return None;
        }
        reveal.ready_monitor_ids.insert(monitor_id);
        if reveal.ready_monitor_ids.len() != reveal.expected_monitor_ids.len() {
            return None;
        }
        inner
            .capture_reveal
            .take()
            .map(|state| state.expected_monitor_ids)
    }

    pub fn force_capture_reveal(&self, revision: &str) -> Option<Vec<u32>> {
        let mut inner = self.inner.lock();
        if !inner.is_current(revision)
            || inner
                .capture_reveal
                .as_ref()
                .map(|state| state.revision.as_str())
                != Some(revision)
        {
            return None;
        }
        inner
            .capture_reveal
            .take()
            .map(|state| state.expected_monitor_ids)
    }

    pub(crate) fn take_scroll(&self, session_id: &str) -> Option<ScrollState> {
        let mut inner = self.inner.lock();
        if !inner.is_current(session_id) {
            return None;
        }
        let scroll = inner.scroll.take()?;
        scroll
            .cancel
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Some(scroll)
    }

    pub(crate) fn reserve_scroll(&self, session_id: &str) -> bool {
        let mut inner = self.inner.lock();
        if !inner.is_current(session_id) || inner.scroll.is_some() || inner.scroll_starting {
            return false;
        }
        inner.scroll_starting = true;
        true
    }

    pub(crate) fn abort_scroll_start(&self, session_id: &str) {
        let mut inner = self.inner.lock();
        if inner.is_current(session_id) {
            inner.scroll_starting = false;
        }
    }

    pub(crate) fn set_scroll(&self, session_id: &str, s: ScrollState) -> bool {
        let mut inner = self.inner.lock();
        if !inner.is_current(session_id) || inner.scroll.is_some() {
            return false;
        }
        inner.scroll_starting = false;
        inner.scroll = Some(s);
        true
    }

    pub(crate) fn scroll_ref<R>(
        &self,
        session_id: &str,
        f: impl FnOnce(&ScrollState) -> R,
    ) -> Option<R> {
        let inner = self.inner.lock();
        if !inner.is_current(session_id) {
            return None;
        }
        inner.scroll.as_ref().map(f)
    }

    pub fn begin_text_input(&self, session_id: &str, input_id: String) -> bool {
        let mut inner = self.inner.lock();
        inner.is_current(session_id) && inner.text_inputs.insert(input_id)
    }

    pub fn end_text_input(&self, session_id: &str, input_id: &str) -> bool {
        let mut inner = self.inner.lock();
        inner.is_current(session_id)
            && inner.text_inputs.remove(input_id)
            && inner.text_inputs.is_empty()
    }

    pub fn text_input_active(&self) -> bool {
        !self.inner.lock().text_inputs.is_empty()
    }

    pub fn end_session(&self, app: &AppHandle, session_id: &str) -> Option<PreviousFrontmostApp> {
        let previous = self.clear_session_state(session_id)?;
        crate::set_capture_session_hotkeys(app, false);
        crate::app_activation::hide_overlay_windows(app);
        let _ = app.emit("capture:end", session_id);
        cleanup_frame_files(app, session_id);
        self.finish_session_end(session_id);
        Some(previous)
    }

    pub fn end_session_deactivating_app(&self, app: &AppHandle, session_id: &str) {
        let Some(_previous) = self.clear_session_state(session_id) else {
            return;
        };
        crate::set_capture_session_hotkeys(app, false);
        if !crate::app_activation::deactivate_then_hide_overlays_macos(app) {
            crate::app_activation::hide_overlay_windows(app);
        }
        let _ = app.emit("capture:end", session_id);
        cleanup_frame_files(app, session_id);
        self.finish_session_end(session_id);
    }

    pub fn restore_focus_to_previous_app(&self, app: &AppHandle, previous: &PreviousFrontmostApp) {
        if !self.in_session() {
            crate::app_activation::reactivate_previous_app(app, previous);
        }
    }

    pub fn reactivate_previous_app(&self, app: &AppHandle, session_id: &str) {
        let previous = {
            let inner = self.inner.lock();
            if !inner.is_current(session_id) {
                return;
            }
            inner.previous_app.clone()
        };
        crate::app_activation::reactivate_previous_app(app, &previous);
    }

    // Keep the reservation until native cleanup has completed. New captures
    // must not begin while an older teardown is still hiding their windows.
    fn clear_session_state(&self, session_id: &str) -> Option<PreviousFrontmostApp> {
        let mut inner = self.inner.lock();
        if !inner.is_current(session_id) {
            return None;
        }
        inner.ending = true;
        inner.frames.clear();
        if let Some(s) = inner.scroll.take() {
            s.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        inner.capture_reveal = None;
        inner.scroll_starting = false;
        inner.text_inputs.clear();
        Some(std::mem::take(&mut inner.previous_app))
    }

    fn finish_session_end(&self, session_id: &str) {
        let mut inner = self.inner.lock();
        if inner.session_id.as_deref() == Some(session_id) && inner.ending {
            inner.session_id = None;
            inner.ending = false;
        }
    }
}

fn cleanup_frame_files(app: &AppHandle, session_id: &str) {
    let Ok(cache_dir) = app.path().app_cache_dir() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let suffix = format!("_{session_id}.png");
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("frame_") && name.ends_with(&suffix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

pub struct SessionGuard {
    mgr: Arc<WindowMgr>,
    app: AppHandle,
    session_id: String,
    ended: bool,
}

impl SessionGuard {
    pub fn end(mut self) {
        self.mgr
            .end_session_deactivating_app(&self.app, &self.session_id);
        self.ended = true;
    }

    pub fn disarm(mut self) {
        self.ended = true;
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if !self.ended {
            self.mgr
                .end_session_deactivating_app(&self.app, &self.session_id);
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
        assert!(mgr.reserve_session("revision-1".into()));
        mgr.store_frame("revision-1", fake_frame(7));
        assert!(mgr.frame("revision-1", 7).is_some());
        assert!(mgr.frame("revision-1", 99).is_none());
    }

    #[test]
    fn frame_retrieval_reuses_shared_rgba_buffer() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("revision-1".into()));
        mgr.store_frame("revision-1", fake_frame(7));

        let first = mgr
            .frame("revision-1", 7)
            .expect("stored frame should exist");
        let second = mgr
            .frame("revision-1", 7)
            .expect("stored frame should exist");

        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn explicit_end_clears_session_state() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("revision-1".into()));
        mgr.store_frame("revision-1", fake_frame(7));

        mgr.clear_session_state("revision-1");
        mgr.finish_session_end("revision-1");

        assert!(!mgr.in_session());
        assert!(mgr.frame("revision-1", 7).is_none());
    }

    #[test]
    fn capture_reveal_waits_for_every_monitor() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("revision-1".into()));
        mgr.prepare_capture_reveal("revision-1".into(), vec![7, 9]);

        assert_eq!(mgr.mark_capture_overlay_ready("revision-1", 7), None);
        assert_eq!(
            mgr.mark_capture_overlay_ready("revision-1", 9),
            Some(vec![7, 9])
        );
        assert_eq!(mgr.force_capture_reveal("revision-1"), None);
    }

    #[test]
    fn capture_reveal_ignores_stale_revisions_and_has_a_timeout_path() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("revision-2".into()));
        mgr.prepare_capture_reveal("revision-2".into(), vec![3, 4]);

        assert_eq!(mgr.mark_capture_overlay_ready("revision-1", 3), None);
        assert_eq!(mgr.force_capture_reveal("revision-1"), None);
        assert_eq!(mgr.force_capture_reveal("revision-2"), Some(vec![3, 4]));
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
        assert!(mgr.reserve_session("revision-1".into()));
        mgr.set_scroll(
            "revision-1",
            super::ScrollState {
                monitor_id: 1,
                logical_rect: crate::types::Rect {
                    x: 0,
                    y: 0,
                    width: 2,
                    height: 2,
                },
                stitcher,
                cancel: cancel.clone(),
            },
        );

        mgr.clear_session_state("revision-1");
        mgr.finish_session_end("revision-1");
        assert!(cancel.load(Ordering::SeqCst), "scroll cancel must be set");
        assert!(mgr.scroll_ref("revision-1", |_| ()).is_none());
    }

    #[test]
    fn capture_session_does_not_reorder_utility_windows_after_overlay_hide() {
        let source = include_str!("window_mgr.rs").replace("\r\n", "\n");
        let begin_body = function_body(&source, "begin");
        let end_body = function_body(&source, "end_session");

        assert!(
            !begin_body.contains("inactive_visible_utility_window_labels"),
            "session start should not snapshot utility windows for later compensation",
        );
        assert!(
            !end_body.contains("order_inactive_utility_windows_back_macos"),
            "capture end must not reorder utility windows; their original z-order should be left untouched",
        );
    }

    #[test]
    fn capture_end_deactivates_without_reordering_previous_app_windows() {
        let source = include_str!("window_mgr.rs").replace("\r\n", "\n");
        let body = function_body(&source, "end_session_deactivating_app");
        assert!(
            body.contains("deactivate_then_hide_overlays_macos")
                && !body.contains("reactivate_then_hide_overlays_macos"),
            "normal capture end must deactivate Flashot without activating every window of the previous app",
        );
    }

    #[test]
    fn capture_end_disarms_session_hotkeys_directly() {
        let source = include_str!("window_mgr.rs").replace("\r\n", "\n");
        for name in ["end_session", "end_session_deactivating_app"] {
            let body = function_body(&source, name);
            let cleanup_idx = body
                .find("crate::set_capture_session_hotkeys(app, false);")
                .unwrap_or_else(|| panic!("{name} must directly disarm session hotkeys"));
            let emit_idx = body
                .find("app.emit(\"capture:end\"")
                .unwrap_or_else(|| panic!("{name} must emit capture:end"));

            assert!(
                cleanup_idx < emit_idx,
                "{name} must release global session hotkeys before broadcasting capture:end",
            );
        }
    }

    fn function_body<'a>(source: &'a str, name: &str) -> &'a str {
        let needle = format!("fn {name}");
        let start = source
            .find(&needle)
            .unwrap_or_else(|| panic!("{name} not found"));
        let body_start = source[start..].find('{').map(|idx| start + idx).unwrap();
        let mut depth = 0usize;
        for (idx, ch) in source[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return &source[body_start..body_start + idx + 1];
                    }
                }
                _ => {}
            }
        }
        panic!("{name} body did not close");
    }

    #[test]
    fn stale_sessions_cannot_read_write_reveal_or_end_the_next_capture() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("old".into()));
        assert!(mgr.store_frame("old", fake_frame(7)));
        assert!(mgr.clear_session_state("old").is_some());
        assert!(!mgr.reserve_session("too-early".into()));
        mgr.finish_session_end("old");
        assert!(mgr.reserve_session("new".into()));
        assert!(mgr.store_frame("new", fake_frame(7)));
        assert!(mgr.frame("old", 7).is_none());
        assert!(!mgr.store_frame("old", fake_frame(9)));
        assert!(!mgr.prepare_capture_reveal("old".into(), vec![7]));
        assert!(mgr.clear_session_state("old").is_none());
        mgr.finish_session_end("old");
        assert!(mgr.is_current("new"));
        assert!(mgr.frame("new", 7).is_some());
    }

    #[test]
    fn scroll_start_reservations_are_exclusive_and_session_scoped() {
        let mgr = WindowMgr::new();
        assert!(mgr.reserve_session("one".into()));
        assert!(mgr.reserve_scroll("one"));
        assert!(!mgr.reserve_scroll("one"));
        mgr.abort_scroll_start("stale");
        assert!(!mgr.reserve_scroll("one"));
        mgr.abort_scroll_start("one");
        assert!(mgr.reserve_scroll("one"));
    }

    #[test]
    fn text_input_shortcuts_resume_only_after_the_last_current_editor() {
        let mgr = WindowMgr::new();
        mgr.reserve_session("one".into());
        assert!(mgr.begin_text_input("one", "editor-a".into()));
        assert!(mgr.begin_text_input("one", "editor-b".into()));
        assert!(!mgr.end_text_input("one", "editor-a"));
        assert!(mgr.text_input_active());
        assert!(mgr.end_text_input("one", "editor-b"));
        assert!(!mgr.text_input_active());
        mgr.clear_session_state("one");
        mgr.finish_session_end("one");
        mgr.reserve_session("two".into());
        mgr.begin_text_input("two", "editor-a".into());
        assert!(!mgr.end_text_input("one", "editor-a"));
        assert!(mgr.text_input_active());
    }
}
