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
pub use types::{OcrError, OcrInstallStatus, OcrLine, OcrPackageInfo, OcrResult, TextBox};

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

/// Resolves the bundled onnxruntime dylib path and configures `ort` to use it.
/// Must be called once early in `tauri::Builder::setup` before any OCR code runs.
pub fn init_ort_dylib(app: &AppHandle) -> Result<()> {
    let path = bundled_dylib_path(app)?;
    validate_ort_dylib_path(Some(&path))?;
    // Safety: ort reads this env var on first use. Setting it before any
    // session creation is safe and supported.
    unsafe { std::env::set_var("ORT_DYLIB_PATH", &path) };
    tracing::info!("ORT_DYLIB_PATH = {}", path.display());
    Ok(())
}

pub(crate) fn ensure_ort_dylib_ready() -> std::result::Result<(), OcrError> {
    let path = std::env::var_os("ORT_DYLIB_PATH").map(PathBuf::from);
    validate_ort_dylib_path(path.as_deref())
}

fn bundled_dylib_path(app: &AppHandle) -> Result<PathBuf> {
    let resource = if cfg!(target_os = "macos") {
        "Frameworks/libonnxruntime.dylib"
    } else if cfg!(target_os = "windows") {
        "onnxruntime.dll"
    } else {
        "lib/libonnxruntime.so"
    };
    let resolved = app
        .path()
        .resolve(resource, tauri::path::BaseDirectory::Resource)
        .with_context(|| format!("resolving bundled dylib resource {resource}"))?;
    if resolved.exists() {
        return Ok(resolved);
    }

    #[cfg(target_os = "linux")]
    {
        let packaged = PathBuf::from("/usr/lib/flashot/libonnxruntime.so");
        if packaged.exists() {
            return Ok(packaged);
        }
    }

    let source = source_dylib_path();
    if source.exists() {
        return Ok(source);
    }

    Ok(resolved)
}

fn source_dylib_path() -> PathBuf {
    let relative = if cfg!(target_os = "macos") {
        Path::new("macos").join("libonnxruntime.dylib")
    } else if cfg!(target_os = "windows") {
        Path::new("windows").join("onnxruntime.dll")
    } else {
        Path::new("linux").join("libonnxruntime.so")
    };
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("lib")
        .join("onnxruntime")
        .join(relative)
}

fn validate_ort_dylib_path(path: Option<&Path>) -> std::result::Result<(), OcrError> {
    let Some(path) = path else {
        return Err(OcrError::RuntimeUnavailable(
            "ORT_DYLIB_PATH is not set; bundled onnxruntime was not found at startup".into(),
        ));
    };
    if !path.exists() {
        return Err(OcrError::RuntimeUnavailable(format!(
            "bundled onnxruntime dylib missing at {}",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(OcrError::RuntimeUnavailable(format!(
            "bundled onnxruntime path is not a file: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ort_dylib_validation_reports_missing_env_path_before_ort_loads() {
        let err = validate_ort_dylib_path(None).unwrap_err();

        assert!(matches!(err, OcrError::RuntimeUnavailable(_)));
        assert!(err.to_string().contains("ORT_DYLIB_PATH"));
    }

    #[test]
    fn ort_dylib_validation_accepts_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let dylib = dir.path().join("libonnxruntime.dylib");
        std::fs::write(&dylib, b"test").unwrap();

        validate_ort_dylib_path(Some(&dylib)).unwrap();
    }
}
