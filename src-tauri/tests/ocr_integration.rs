//! Integration tests for the full OCR pipeline. These tests are `#[ignore]`d
//! because they require:
//!   1. Model files installed locally at `${app_data}/dev.flashot.app/ocr/1.0.0/`.
//!      Place det.onnx, rec.onnx, ppocr_keys_v1.txt there.
//!   2. PNG fixtures under `tests/fixtures/ocr/`. See that directory's README.
//!
//! Run manually:
//!     cargo test --test ocr_integration -- --ignored

use std::path::PathBuf;

use flashot_lib::ocr::engine::Engine;

fn load_fixture(name: &str) -> (Vec<u8>, u32, u32) {
    let path: PathBuf = ["tests", "fixtures", "ocr", name].iter().collect();
    let img = image::open(&path).expect("fixture missing");
    let (w, h) = (img.width(), img.height());
    let rgba = img.to_rgba8().into_raw();
    (rgba, w, h)
}

fn install_dir() -> PathBuf {
    // Mirror the production install_dir: `${app_data}/dev.flashot.app/ocr/1.0.0`.
    let base = dirs::data_dir().expect("no app_data dir");
    // Bundle identifier matches `tauri.conf.json` `identifier` = "dev.flashot.app".
    // On macOS this maps to ~/Library/Application Support/dev.flashot.app
    base.join("dev.flashot.app").join("ocr").join("1.0.0")
}

#[test]
#[ignore = "requires model files at ${app_data}/dev.flashot.app/ocr/1.0.0/"]
fn recognize_english_code() {
    Engine::global().ensure_loaded(&install_dir()).unwrap();
    let (rgba, w, h) = load_fixture("english_code.png");
    let r = Engine::global().recognize(&rgba, w, h).unwrap();
    assert!(!r.full_text.is_empty(), "no text recognised");
    assert!(
        r.full_text.contains("fn"),
        "expected `fn` token, got: {}",
        r.full_text
    );
}

#[test]
#[ignore = "requires model files"]
fn recognize_chinese_ui() {
    Engine::global().ensure_loaded(&install_dir()).unwrap();
    let (rgba, w, h) = load_fixture("chinese_ui.png");
    let r = Engine::global().recognize(&rgba, w, h).unwrap();
    assert!(!r.full_text.is_empty());
    assert!(
        r.full_text.contains("设置") || r.full_text.contains("文件"),
        "expected a Chinese UI token, got: {}",
        r.full_text
    );
}

#[test]
#[ignore = "requires model files"]
fn recognize_mixed_zh_en() {
    Engine::global().ensure_loaded(&install_dir()).unwrap();
    let (rgba, w, h) = load_fixture("mixed_zh_en.png");
    let r = Engine::global().recognize(&rgba, w, h).unwrap();
    assert!(!r.full_text.is_empty());
}
