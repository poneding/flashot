//! OCR inference engine. Owns the `ort::Session`s for detection and
//! recognition, plus the character table used by the CTC decoder.
//!
//! The engine is a process-wide singleton (see `Engine::global`). Sessions
//! are loaded lazily on first use and remain resident for the life of the
//! process. Inference is serialised through a mutex because `ort` sessions
//! are not safe to call concurrently.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use ort::session::Session;

use crate::ocr::types::OcrError;

pub struct Engine {
    det: OnceLock<Session>,
    rec: OnceLock<Session>,
    rec_keys: OnceLock<Vec<String>>,
    // Used by recognition pipeline added in subsequent tasks.
    #[allow(dead_code)]
    inference_lock: Mutex<()>,
}

static ENGINE: OnceLock<Engine> = OnceLock::new();

impl Engine {
    pub fn global() -> &'static Engine {
        ENGINE.get_or_init(|| Engine {
            det: OnceLock::new(),
            rec: OnceLock::new(),
            rec_keys: OnceLock::new(),
            inference_lock: Mutex::new(()),
        })
    }

    pub fn is_ready(&self) -> bool {
        self.det.get().is_some() && self.rec.get().is_some() && self.rec_keys.get().is_some()
    }

    /// Loads all models from `install_dir`. Idempotent. Returns
    /// `OcrError::ModelNotInstalled` if any required file is missing.
    pub fn ensure_loaded(&self, install_dir: &Path) -> Result<(), OcrError> {
        if self.is_ready() {
            return Ok(());
        }

        let det_path = install_dir.join("det.onnx");
        let rec_path = install_dir.join("rec.onnx");
        let keys_path = install_dir.join("ppocr_keys_v1.txt");
        for p in [&det_path, &rec_path, &keys_path] {
            if !p.exists() {
                return Err(OcrError::ModelNotInstalled);
            }
        }

        // Load character table.
        let keys_text = std::fs::read_to_string(&keys_path)?;
        let mut keys: Vec<String> = keys_text.lines().map(|s| s.to_string()).collect();
        // PaddleOCR convention: a "blank" symbol at index 0 for CTC.
        keys.insert(0, String::new());
        // Trailing space token used by some PP-OCR variants.
        keys.push(" ".into());

        let det = load_session(&det_path)?;
        let rec = load_session(&rec_path)?;

        let _ = self.det.set(det);
        let _ = self.rec.set(rec);
        let _ = self.rec_keys.set(keys);
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn det(&self) -> &Session {
        self.det.get().expect("ensure_loaded must be called first")
    }
    #[allow(dead_code)]
    pub(crate) fn rec(&self) -> &Session {
        self.rec.get().expect("ensure_loaded must be called first")
    }
    #[allow(dead_code)]
    pub(crate) fn rec_keys(&self) -> &[String] {
        self.rec_keys.get().expect("ensure_loaded must be called first")
    }
    #[allow(dead_code)]
    pub(crate) fn inference_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.inference_lock.lock().expect("inference mutex poisoned")
    }
}

#[cfg(target_os = "macos")]
fn load_session(path: &Path) -> Result<Session, OcrError> {
    use ort::execution_providers::CoreMLExecutionProvider;
    Session::builder()
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))?
        .with_execution_providers([CoreMLExecutionProvider::default().build()])
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))?
        .commit_from_file(path)
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))
}

#[cfg(target_os = "windows")]
fn load_session(path: &Path) -> Result<Session, OcrError> {
    use ort::execution_providers::DirectMLExecutionProvider;
    Session::builder()
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))?
        .with_execution_providers([DirectMLExecutionProvider::default().build()])
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))?
        .commit_from_file(path)
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn load_session(path: &Path) -> Result<Session, OcrError> {
    Session::builder()
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))?
        .commit_from_file(path)
        .map_err(|e| OcrError::ModelLoadFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_loaded_missing_returns_not_installed() {
        let tmp = tempfile::tempdir().unwrap();
        let err = Engine::global().ensure_loaded(tmp.path()).unwrap_err();
        assert!(matches!(err, OcrError::ModelNotInstalled));
    }
}
