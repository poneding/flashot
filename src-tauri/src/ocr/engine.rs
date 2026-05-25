//! OCR inference engine. Owns the `ort::Session`s for detection and
//! recognition, plus the character table used by the CTC decoder.
//!
//! The engine is a process-wide singleton (see `Engine::global`). Sessions
//! are loaded lazily on first use and remain resident for the life of the
//! process. Each session is wrapped in a `Mutex` because `ort::Session::run`
//! takes `&mut self` and the sessions are not safe to call concurrently.

use std::path::Path;
use std::sync::{Mutex, MutexGuard, OnceLock};

use ort::session::Session;

use crate::ocr::types::OcrError;

/// OCR inference engine that manages the detection and recognition sessions.
///
/// **Concurrency model:** Each `Mutex<Session>` protects against concurrent
/// `Session::run` calls on that session, as required by ort (not thread-safe
/// per-session). However, the Engine itself does NOT serialize `det` and `rec`
/// access — callers (e.g., `Engine::recognize` in Task 14) must acquire
/// these guards **sequentially**, never simultaneously. This design keeps the
/// per-session mutex model coherent. If concurrent recognition pipelines are
/// needed in the future, a top-level coordinator would be required.
pub struct Engine {
    det: OnceLock<Mutex<Session>>,
    rec: OnceLock<Mutex<Session>>,
    rec_keys: OnceLock<Vec<String>>,
}

static ENGINE: OnceLock<Engine> = OnceLock::new();

impl Engine {
    pub fn global() -> &'static Engine {
        ENGINE.get_or_init(|| Engine {
            det: OnceLock::new(),
            rec: OnceLock::new(),
            rec_keys: OnceLock::new(),
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
        crate::ocr::ensure_ort_dylib_ready()?;

        // Load character table.
        let keys_text = std::fs::read_to_string(&keys_path)?;
        let mut keys: Vec<String> = keys_text.lines().map(|s| s.to_string()).collect();
        // PaddleOCR convention: a "blank" symbol at index 0 for CTC.
        keys.insert(0, String::new());
        // Trailing space token used by some PP-OCR variants.
        keys.push(" ".into());

        let det = load_session(&det_path)?;
        let rec = load_session(&rec_path)?;

        let _ = self.det.set(Mutex::new(det));
        let _ = self.rec.set(Mutex::new(rec));
        let _ = self.rec_keys.set(keys);
        Ok(())
    }

    /// Acquire exclusive access to the detection session. Blocks until any
    /// in-flight detection finishes. Panics if `ensure_loaded` was not called.
    pub(crate) fn det(&self) -> MutexGuard<'_, Session> {
        self.det
            .get()
            .expect("ensure_loaded must be called first")
            .lock()
            .expect("det session mutex poisoned")
    }

    /// Acquire exclusive access to the recognition session. Used by Task 12.
    #[allow(dead_code)]
    pub(crate) fn rec(&self) -> MutexGuard<'_, Session> {
        self.rec
            .get()
            .expect("ensure_loaded must be called first")
            .lock()
            .expect("rec session mutex poisoned")
    }

    /// Recognition character table. Used by the CTC decoder in Task 12.
    #[allow(dead_code)]
    pub(crate) fn rec_keys(&self) -> &[String] {
        self.rec_keys
            .get()
            .expect("ensure_loaded must be called first")
    }
}

#[cfg(target_os = "macos")]
fn load_session(path: &Path) -> Result<Session, OcrError> {
    Session::builder()
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

use std::time::Instant;

use crate::ocr::types::{OcrLine, OcrResult, TextBox};
use crate::ocr::{detector, postprocess, recognizer};

const MAX_RECOGNITION_BOXES: usize = 120;

impl Engine {
    /// End-to-end recognition: detect → warp each box → recognise → sort →
    /// filter → concat. CPU-bound; callers must invoke via
    /// `tokio::task::spawn_blocking`. Acquires det and rec guards
    /// SEQUENTIALLY via the public detector::detect and recognizer::recognize
    /// functions (det is held only across detector::detect, rec only across
    /// recognizer::recognize per text-line), so the per-session-mutex
    /// concurrency model documented above is preserved.
    pub fn recognize(&self, rgba: &[u8], w: u32, h: u32) -> Result<OcrResult, OcrError> {
        let start = Instant::now();

        let mut boxes = detector::detect(rgba, w, h)?;
        if boxes.len() > MAX_RECOGNITION_BOXES {
            tracing::warn!(
                "OCR detected {} text candidates; limiting recognition to {}",
                boxes.len(),
                MAX_RECOGNITION_BOXES
            );
            boxes.sort_by(|a, b| {
                bbox_area(b)
                    .partial_cmp(&bbox_area(a))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            boxes.truncate(MAX_RECOGNITION_BOXES);
        }
        let mut lines = Vec::with_capacity(boxes.len());
        for bbox in &boxes {
            let (crop, cw, ch) = match warp_textline(rgba, w, h, bbox) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("textline warp failed: {e}; skipping");
                    continue;
                }
            };
            let (text, conf) = recognizer::recognize(&crop, cw, ch)?;
            if !text.is_empty() {
                lines.push(OcrLine {
                    text,
                    bbox: bbox.clone(),
                    confidence: conf,
                });
            }
        }

        let lines = postprocess::filter_low_confidence(lines);
        let lines = postprocess::sort_reading_order(lines);
        let full_text = postprocess::concatenate(&lines);

        Ok(OcrResult {
            full_text,
            lines,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }
}

/// Warp the quadrilateral `bbox` from the source RGBA image into an
/// axis-aligned crop ready for the recogniser.
fn warp_textline(
    rgba: &[u8],
    w: u32,
    h: u32,
    bbox: &TextBox,
) -> Result<(Vec<u8>, u32, u32), OcrError> {
    use image::{Rgba, RgbaImage};
    use imageproc::geometric_transformations::{warp_into, Interpolation, Projection};

    let dist =
        |(x1, y1): (f32, f32), (x2, y2): (f32, f32)| ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    let top = dist(bbox.points[0], bbox.points[1]);
    let bottom = dist(bbox.points[3], bbox.points[2]);
    let left = dist(bbox.points[0], bbox.points[3]);
    let right = dist(bbox.points[1], bbox.points[2]);
    let crop_w = top.max(bottom).round().max(1.0) as u32;
    let crop_h = left.max(right).round().max(1.0) as u32;

    let src_img = RgbaImage::from_raw(w, h, rgba.to_vec())
        .ok_or_else(|| OcrError::InferenceFailed("source dims mismatch".into()))?;

    let proj = Projection::from_control_points(
        [
            bbox.points[0],
            bbox.points[1],
            bbox.points[2],
            bbox.points[3],
        ],
        [
            (0.0, 0.0),
            (crop_w as f32, 0.0),
            (crop_w as f32, crop_h as f32),
            (0.0, crop_h as f32),
        ],
    )
    .ok_or_else(|| OcrError::InferenceFailed("degenerate quad".into()))?;

    let mut crop_img = RgbaImage::from_pixel(crop_w, crop_h, Rgba([0, 0, 0, 255]));
    warp_into(
        &src_img,
        &proj,
        Interpolation::Bilinear,
        Rgba([0, 0, 0, 255]),
        &mut crop_img,
    );
    Ok((crop_img.into_raw(), crop_w, crop_h))
}

fn bbox_area(b: &TextBox) -> f32 {
    let width =
        ((b.points[1].0 - b.points[0].0).powi(2) + (b.points[1].1 - b.points[0].1).powi(2)).sqrt();
    let height =
        ((b.points[3].0 - b.points[0].0).powi(2) + (b.points[3].1 - b.points[0].1).powi(2)).sqrt();
    width * height
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

    #[test]
    fn warp_textline_handles_boxes_larger_than_the_source_image() {
        let rgba = vec![255u8; 20 * 12 * 4];
        let bbox = TextBox {
            points: [(-5.0, -3.0), (35.0, -3.0), (35.0, 20.0), (-5.0, 20.0)],
        };

        let (crop, w, h) = warp_textline(&rgba, 20, 12, &bbox).expect("warp should not panic");

        assert_eq!(w, 40);
        assert_eq!(h, 23);
        assert_eq!(crop.len(), (w * h * 4) as usize);
    }

    #[test]
    fn warp_textline_maps_source_box_into_crop() {
        let mut rgba = vec![0u8; 12 * 8 * 4];
        for y in 2..6 {
            for x in 3..9 {
                let off = ((y * 12 + x) * 4) as usize;
                rgba[off..off + 4].copy_from_slice(&[255, 0, 0, 255]);
            }
        }
        let bbox = TextBox {
            points: [(3.0, 2.0), (9.0, 2.0), (9.0, 6.0), (3.0, 6.0)],
        };

        let (crop, w, h) = warp_textline(&rgba, 12, 8, &bbox).expect("warp should succeed");

        assert_eq!((w, h), (6, 4));
        let center = (((h / 2) * w + (w / 2)) * 4) as usize;
        assert!(
            crop[center] > 200,
            "center red channel should come from source box"
        );
        assert!(
            crop[center + 1] < 50,
            "center green channel should stay low"
        );
        assert!(crop[center + 2] < 50, "center blue channel should stay low");
    }
}
