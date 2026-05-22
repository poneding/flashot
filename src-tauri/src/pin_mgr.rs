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

    #[allow(dead_code)]
    pub fn all_pin_ids(&self) -> Vec<String> {
        self.inner.lock().pins.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_manager_starts_empty() {
        let mgr = PinManager::new();
        let inner = mgr.inner.lock();
        assert_eq!(inner.pins.len(), 0);
    }

    #[test]
    fn add_pin_stores_entry() {
        let mgr = PinManager::new();
        let entry = PinEntry {
            id: "test-id".to_string(),
            image_path: PathBuf::from("/tmp/test.png"),
            annotation_path: Some(PathBuf::from("/tmp/test-annotation.png")),
            window_label: "pin-test-id".to_string(),
            original_width: 100,
            original_height: 100,
            current_scale: 1.0,
        };

        mgr.add_pin(entry.clone());

        let retrieved = mgr.get_pin("test-id").unwrap();
        assert_eq!(retrieved.id, "test-id");
        assert_eq!(
            retrieved.annotation_path.as_deref(),
            Some(std::path::Path::new("/tmp/test-annotation.png")),
        );
        assert_eq!(retrieved.original_width, 100);
    }
}
