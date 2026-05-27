use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct PinEntry {
    pub id: String,
    pub image_path: PathBuf,
    pub annotation_path: Option<PathBuf>,
    pub window_label: String,
    pub original_width: u32,
    pub original_height: u32,
    pub current_scale: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PinPaths {
    pub image_path: PathBuf,
    pub annotation_path: Option<PathBuf>,
}

#[derive(Default)]
pub struct PinManager {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    pins: HashMap<String, PinEntry>,
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
        self.inner.lock().pins.remove(id)
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

    fn sample_entry() -> PinEntry {
        PinEntry {
            id: "test-id".to_string(),
            image_path: PathBuf::from("/tmp/test.png"),
            annotation_path: Some(PathBuf::from("/tmp/test-annotation.png")),
            window_label: "pin-test-id".to_string(),
            original_width: 100,
            original_height: 100,
            current_scale: 1.0,
        }
    }

    #[test]
    fn pin_manager_starts_empty() {
        let mgr = PinManager::new();
        let inner = mgr.inner.lock();
        assert_eq!(inner.pins.len(), 0);
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
        assert!(mgr.get_pin("test-id").is_some());
    }
}
