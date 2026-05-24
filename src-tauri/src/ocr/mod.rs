//! Offline OCR via PaddleOCR PP-OCRv4 + onnxruntime (via `ort`).
//!
//! The runtime onnxruntime dynamic library is bundled with the app and
//! discovered at startup by [`init_ort_dylib`]. Engine loading, model
//! download, and the recognition pipeline live in the submodules below.

pub mod commands;
pub mod detector;
pub mod download;
pub mod engine;
pub mod manifest;
pub mod paths;
pub mod postprocess;
pub mod recognizer;
pub mod types;
pub use types::{OcrError, OcrInstallStatus, OcrLine, OcrResult, TextBox};

use std::path::PathBuf;

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

/// Resolves the bundled onnxruntime dylib path and configures `ort` to use it.
/// Must be called once early in `tauri::Builder::setup` before any OCR code runs.
pub fn init_ort_dylib(app: &AppHandle) -> Result<()> {
    let path = bundled_dylib_path(app)?;
    if !path.exists() {
        anyhow::bail!("bundled onnxruntime dylib missing at {}", path.display());
    }
    // Safety: ort reads this env var on first use. Setting it before any
    // session creation is safe and supported.
    unsafe { std::env::set_var("ORT_DYLIB_PATH", &path) };
    tracing::info!("ORT_DYLIB_PATH = {}", path.display());
    Ok(())
}

fn bundled_dylib_path(app: &AppHandle) -> Result<PathBuf> {
    let resource = if cfg!(target_os = "macos") {
        "Frameworks/libonnxruntime.dylib"
    } else if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else {
        "lib/libonnxruntime.so"
    };
    app.path()
        .resolve(resource, tauri::path::BaseDirectory::Resource)
        .with_context(|| format!("resolving bundled dylib resource {resource}"))
}
