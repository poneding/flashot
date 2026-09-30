use crate::pin_geometry::{PinResizeSession, PinToolKind, PinToolLayout, PinToolWindowState};
use parking_lot::Mutex;
use std::collections::{HashMap, hash_map::Entry};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

const MOTION_SETTLE_TIME: Duration = Duration::from_millis(100);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinToolsEnvelope {
    pub pin_id: String,
    pub revision: u64,
    pub state: serde_json::Value,
}

#[derive(Clone, Default)]
pub struct PinToolsState {
    pub snapshot: Option<PinToolsEnvelope>,
    pub controls: Option<PinToolLayout>,
    pub editor: Option<PinToolLayout>,
    windows: [Option<PinToolWindowState>; 2],
    placement_dirty: [bool; 2],
}

#[derive(Clone, Copy)]
pub struct PinToolPresentation {
    pub kind: PinToolKind,
    pub visible: bool,
    pub layout: Option<PinToolLayout>,
    pub applied: Option<PinToolWindowState>,
    pub notify_placement: bool,
}

#[derive(Clone)]
pub struct PinEntry {
    pub id: String,
    pub image_path: PathBuf,
    pub annotation_path: Option<PathBuf>,
    pub window_label: String,
    pub original_width: u32,
    pub original_height: u32,
    pub current_scale: f64,
    pub corner_radius: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PinPaths {
    pub image_path: PathBuf,
    pub annotation_path: Option<PathBuf>,
    pub original_width: u32,
    pub original_height: u32,
    pub corner_radius: u32,
}

#[derive(Default)]
pub struct PinManager {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    pins: HashMap<String, PinEntry>,
    tools: HashMap<String, PinToolsState>,
    resizes: HashMap<String, (String, PinResizeSession)>,
    // None means a content/size change that should be laid out immediately.
    // Motion only needs screen-edge correction after the window stops moving.
    pending_tool_repositions: HashMap<String, Option<Instant>>,
}

impl PinManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn add_pin(&self, entry: PinEntry) {
        self.inner.lock().pins.insert(entry.id.clone(), entry);
    }

    pub fn get_pin(&self, id: &str) -> Option<PinEntry> {
        self.inner.lock().pins.get(id).cloned()
    }

    pub fn remove_pin(&self, id: &str) -> Option<PinEntry> {
        let mut inner = self.inner.lock();
        inner.tools.remove(id);
        inner.resizes.remove(id);
        inner.pending_tool_repositions.remove(id);
        inner.pins.remove(id)
    }

    pub fn tools_state(&self, id: &str) -> Option<PinToolsState> {
        let inner = self.inner.lock();
        inner.pins.get(id)?;
        Some(inner.tools.get(id).cloned().unwrap_or_default())
    }

    /// Geometry updates must not clone the annotation document on every move.
    pub fn take_tool_presentations(&self, id: &str) -> Option<[PinToolPresentation; 2]> {
        let mut inner = self.inner.lock();
        inner.pins.get(id)?;
        let tools = inner.tools.get_mut(id)?;
        let state = tools.snapshot.as_ref().map(|s| &s.state);
        let editing = state
            .and_then(|s| s.get("editing"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let visible = state
            .and_then(|s| s.get("visible"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let presentations = [
            PinToolPresentation {
                kind: PinToolKind::Controls,
                visible: visible || editing,
                layout: tools.controls,
                applied: tools.windows[0],
                notify_placement: tools.placement_dirty[0],
            },
            PinToolPresentation {
                kind: PinToolKind::Editor,
                visible: editing,
                layout: tools.editor,
                applied: tools.windows[1],
                notify_placement: tools.placement_dirty[1],
            },
        ];
        tools.placement_dirty = [false, false];
        Some(presentations)
    }

    pub fn set_tool_window_state(&self, id: &str, kind: PinToolKind, state: PinToolWindowState) {
        if let Some(tools) = self.inner.lock().tools.get_mut(id) {
            let index = match kind {
                PinToolKind::Controls => 0,
                PinToolKind::Editor => 1,
            };
            tools.windows[index] = Some(state);
        }
    }

    pub fn tool_windows(&self, id: &str) -> Option<[(PinToolKind, Option<PinToolWindowState>); 2]> {
        let inner = self.inner.lock();
        let tools = inner.tools.get(id)?;
        Some([
            (PinToolKind::Controls, tools.windows[0]),
            (PinToolKind::Editor, tools.windows[1]),
        ])
    }

    pub fn queue_tool_reposition(&self, id: &str) -> bool {
        let mut inner = self.inner.lock();
        if !inner.pins.contains_key(id) {
            return false;
        }
        inner
            .pending_tool_repositions
            .insert(id.to_string(), None)
            .is_none()
    }

    pub fn queue_tool_motion(&self, id: &str) -> bool {
        self.queue_tool_motion_at(id, Instant::now())
    }

    fn queue_tool_motion_at(&self, id: &str, now: Instant) -> bool {
        let mut inner = self.inner.lock();
        if !inner.pins.contains_key(id) {
            return false;
        }
        match inner.pending_tool_repositions.entry(id.to_string()) {
            Entry::Vacant(entry) => {
                entry.insert(Some(now));
                true
            }
            Entry::Occupied(mut entry) => {
                if entry.get().is_some() {
                    entry.insert(Some(now));
                }
                false
            }
        }
    }

    pub fn tool_reposition_delay(&self, id: &str) -> Option<Duration> {
        self.tool_reposition_delay_at(id, Instant::now())
    }

    fn tool_reposition_delay_at(&self, id: &str, now: Instant) -> Option<Duration> {
        self.inner
            .lock()
            .pending_tool_repositions
            .get(id)
            .map(|last_motion| {
                last_motion.map_or(Duration::ZERO, |last| {
                    MOTION_SETTLE_TIME.saturating_sub(now.saturating_duration_since(last))
                })
            })
    }

    pub fn take_tool_reposition(&self, id: &str) -> bool {
        let mut inner = self.inner.lock();
        if inner
            .pending_tool_repositions
            .get(id)
            .is_some_and(|last| last.is_some_and(|last| last.elapsed() < MOTION_SETTLE_TIME))
        {
            return false;
        }
        inner.pending_tool_repositions.remove(id).is_some()
    }

    pub fn set_tools_snapshot(
        &self,
        id: &str,
        state: serde_json::Value,
    ) -> Option<PinToolsEnvelope> {
        let mut inner = self.inner.lock();
        inner.pins.get(id)?;
        let tools = inner.tools.entry(id.to_string()).or_default();
        let snapshot = PinToolsEnvelope {
            pin_id: id.to_string(),
            revision: tools.snapshot.as_ref().map_or(1, |s| s.revision + 1),
            state,
        };
        tools.snapshot = Some(snapshot.clone());
        Some(snapshot)
    }

    pub fn set_tool_layout(
        &self,
        id: &str,
        kind: PinToolKind,
        layout: PinToolLayout,
    ) -> Option<()> {
        let mut inner = self.inner.lock();
        inner.pins.get(id)?;
        let tools = inner.tools.entry(id.to_string()).or_default();
        match kind {
            PinToolKind::Controls => {
                tools.controls = Some(layout);
                tools.placement_dirty[0] = true;
            }
            PinToolKind::Editor => {
                tools.editor = Some(layout);
                tools.placement_dirty[1] = true;
            }
        }
        Some(())
    }

    pub fn begin_resize(&self, id: &str, token: String, session: PinResizeSession) -> Option<()> {
        let mut inner = self.inner.lock();
        inner.pins.get(id)?;
        inner.resizes.insert(id.to_string(), (token, session));
        Some(())
    }

    pub fn resize_session(&self, id: &str, token: &str) -> Option<PinResizeSession> {
        self.inner
            .lock()
            .resizes
            .get(id)
            .filter(|(current, _)| current == token)
            .map(|(_, session)| *session)
    }

    pub fn end_resize(&self, id: &str, token: &str) {
        let mut inner = self.inner.lock();
        if inner
            .resizes
            .get(id)
            .is_some_and(|(current, _)| current == token)
        {
            inner.resizes.remove(id);
        }
    }

    pub fn update_scale(&self, id: &str, scale: f64) -> Option<PinEntry> {
        let mut inner = self.inner.lock();
        let entry = inner.pins.get_mut(id)?;
        entry.current_scale = scale;
        Some(entry.clone())
    }

    pub fn update_annotation(
        &self,
        id: &str,
        annotation_path: Option<PathBuf>,
    ) -> Option<PinEntry> {
        let mut inner = self.inner.lock();
        let entry = inner.pins.get_mut(id)?;
        entry.annotation_path = annotation_path;
        Some(entry.clone())
    }

    pub fn pin_paths(&self, id: &str) -> Option<PinPaths> {
        let inner = self.inner.lock();
        let entry = inner.pins.get(id)?;
        Some(PinPaths {
            image_path: entry.image_path.clone(),
            annotation_path: entry.annotation_path.clone(),
            original_width: entry.original_width,
            original_height: entry.original_height,
            corner_radius: entry.corner_radius,
        })
    }

    #[allow(dead_code)]
    pub fn all_pin_ids(&self) -> Vec<String> {
        self.inner.lock().pins.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuous_motion_defers_edge_placement_until_the_last_move_settles() {
        let mgr = PinManager::new();
        mgr.add_pin(sample_entry());
        let start = Instant::now();
        assert!(mgr.queue_tool_motion_at("test-id", start));
        assert_eq!(
            mgr.tool_reposition_delay_at("test-id", start),
            Some(MOTION_SETTLE_TIME)
        );
        // New move events reuse one pending job, but extend its quiet period.
        for frame in 1..120 {
            let now = start + Duration::from_millis(frame * 8);
            assert!(!mgr.queue_tool_motion_at("test-id", now));
            assert_eq!(
                mgr.tool_reposition_delay_at("test-id", now),
                Some(MOTION_SETTLE_TIME)
            );
        }
        let settled = start + Duration::from_millis(119 * 8) + MOTION_SETTLE_TIME;
        assert_eq!(
            mgr.tool_reposition_delay_at("test-id", settled),
            Some(Duration::ZERO)
        );
        mgr.remove_pin("test-id");
        assert_eq!(mgr.tool_reposition_delay_at("test-id", settled), None);
    }

    #[test]
    fn content_layout_takes_priority_over_a_pending_motion_correction() {
        let mgr = PinManager::new();
        mgr.add_pin(sample_entry());
        let now = Instant::now();
        assert!(mgr.queue_tool_motion_at("test-id", now));
        assert!(!mgr.queue_tool_reposition("test-id"));
        assert!(!mgr.queue_tool_motion_at("test-id", now));
        assert_eq!(
            mgr.tool_reposition_delay_at("test-id", now),
            Some(Duration::ZERO)
        );
        assert!(mgr.take_tool_reposition("test-id"));
        assert!(mgr.queue_tool_motion_at("test-id", now));
    }

    #[test]
    fn move_bursts_coalesce_and_owner_cleanup_cancels_pending_layout() {
        let mgr = PinManager::new();
        mgr.add_pin(sample_entry());
        assert!(mgr.queue_tool_reposition("test-id"));
        for _ in 0..100 {
            assert!(!mgr.queue_tool_reposition("test-id"));
        }
        assert!(mgr.take_tool_reposition("test-id"));
        assert!(!mgr.take_tool_reposition("test-id"));
        // A final move arriving during the previous layout gets another pass.
        assert!(mgr.queue_tool_reposition("test-id"));
        mgr.remove_pin("test-id");
        assert!(!mgr.take_tool_reposition("test-id"));
        assert!(!mgr.queue_tool_reposition("test-id"));
    }

    fn sample_entry() -> PinEntry {
        PinEntry {
            id: "test-id".to_string(),
            image_path: PathBuf::from("/tmp/test.png"),
            annotation_path: Some(PathBuf::from("/tmp/test-annotation.png")),
            window_label: "pin-test-id".to_string(),
            original_width: 100,
            original_height: 100,
            current_scale: 1.0,
            corner_radius: 0,
        }
    }

    #[test]
    fn pin_manager_starts_empty() {
        let mgr = PinManager::new();
        let inner = mgr.inner.lock();
        assert_eq!(inner.pins.len(), 0);
    }

    #[test]
    fn closing_a_pin_drops_palette_state_and_resize_sessions() {
        let mgr = PinManager::new();
        mgr.add_pin(sample_entry());
        mgr.set_tools_snapshot(
            "test-id",
            serde_json::json!({ "visible": true, "editing": false }),
        );
        let session = PinResizeSession {
            origin: crate::pin_geometry::PinRect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            scale: 1.0,
            dpi: 1.0,
            direction: crate::pin_geometry::PinResizeDirection::East,
        };
        mgr.begin_resize("test-id", "old".into(), session);
        mgr.begin_resize("test-id", "new".into(), session);
        mgr.end_resize("test-id", "old");
        assert!(mgr.resize_session("test-id", "new").is_some());
        mgr.remove_pin("test-id");
        assert!(mgr.tools_state("test-id").is_none());
        assert!(mgr.resize_session("test-id", "new").is_none());
    }

    #[test]
    fn pin_manager_add_pin_stores_entry() {
        let mgr = PinManager::new();
        let entry = sample_entry();

        mgr.add_pin(entry.clone());

        let retrieved = mgr.get_pin("test-id").unwrap();
        assert_eq!(retrieved.id, "test-id");
        assert_eq!(
            retrieved.annotation_path.as_deref(),
            Some(std::path::Path::new("/tmp/test-annotation.png")),
        );
        assert_eq!(retrieved.original_width, 100);
        assert_eq!(retrieved.corner_radius, 0);
    }

    #[test]
    fn pin_manager_update_scale_keeps_existing_pin_entry_and_paths() {
        let mgr = PinManager::new();
        let entry = sample_entry();
        mgr.add_pin(entry.clone());

        let updated = mgr
            .update_scale("test-id", 1.55)
            .expect("existing pin scale should update");

        assert_eq!(updated.current_scale, 1.55);
        assert_eq!(updated.image_path, entry.image_path);
        assert_eq!(updated.annotation_path, entry.annotation_path);
        assert_eq!(updated.corner_radius, entry.corner_radius);
        assert!(mgr.get_pin("test-id").is_some());
    }

    #[test]
    fn pin_manager_update_annotation_replaces_annotation_path_without_removing_pin() {
        let mgr = PinManager::new();
        mgr.add_pin(sample_entry());
        let next_path = PathBuf::from("/tmp/test-annotation-next.png");

        let updated = mgr
            .update_annotation("test-id", Some(next_path.clone()))
            .expect("existing pin annotation should update");

        assert_eq!(updated.annotation_path, Some(next_path.clone()));
        assert_eq!(
            mgr.get_pin("test-id").unwrap().annotation_path,
            Some(next_path),
        );
    }

    #[test]
    fn pin_manager_pin_paths_returns_current_files_without_removing_pin() {
        let mgr = PinManager::new();
        let entry = sample_entry();
        mgr.add_pin(entry.clone());

        let paths = mgr.pin_paths("test-id").expect("pin paths should exist");

        assert_eq!(paths.image_path, entry.image_path);
        assert_eq!(paths.annotation_path, entry.annotation_path);
        assert_eq!(paths.original_width, entry.original_width);
        assert_eq!(paths.original_height, entry.original_height);
        assert_eq!(paths.corner_radius, entry.corner_radius);
        assert!(mgr.get_pin("test-id").is_some());
    }
}
