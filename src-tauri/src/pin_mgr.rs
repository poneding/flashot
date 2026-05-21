use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
#[allow(dead_code)]
pub struct PinEntry {
    pub id: String,
    pub image_path: PathBuf,
    pub window_label: String,
    pub original_width: u32,
    pub original_height: u32,
    pub current_scale: f64,
}

#[derive(Default)]
pub struct PinManager {
    #[allow(dead_code)]
    inner: Mutex<Inner>,
}

#[derive(Default)]
#[allow(dead_code)]
struct Inner {
    pins: HashMap<String, PinEntry>,
}

impl PinManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
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
}
