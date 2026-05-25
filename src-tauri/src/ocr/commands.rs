//! Tauri command handlers for OCR install/status. The recognition command
//! lives in `commands.rs` at the crate root because it depends on `WindowMgr`.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Window};

use crate::ocr::download::{self, ProgressFn};
use crate::ocr::manifest::{self, ASSETS};
use crate::ocr::paths;
use crate::ocr::types::OcrInstallStatus;

#[tauri::command]
pub async fn ocr_status(app: AppHandle) -> OcrInstallStatus {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return OcrInstallStatus::NotInstalled;
    };
    let dir = paths::install_dir(&data_dir);
    let all_present = ASSETS.iter().all(|a| dir.join(a.name).exists());
    if all_present {
        let size = ASSETS.iter().map(|a| a.size_bytes).sum();
        OcrInstallStatus::Installed { size_bytes: size }
    } else {
        OcrInstallStatus::NotInstalled
    }
}

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgressPayload {
    pub progress: f32,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn ocr_install(app: AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    let install_dir = paths::install_dir(&data_dir);

    let total = manifest::total_size_bytes();
    let app_for_progress = app.clone();
    let progress: ProgressFn = Arc::new(move |done, _total| {
        let payload = DownloadProgressPayload {
            progress: done as f32 / total as f32,
            downloaded_bytes: done,
            total_bytes: total,
        };
        let _ = app_for_progress.emit("ocr:download-progress", payload);
    });

    download::download_all(ASSETS, &install_dir, Arc::new(AtomicBool::new(false)), progress)
        .await
        .map_err(|e| format!("{e}"))?;

    // Best-effort cleanup of other versions.
    let parent = install_dir.parent().unwrap().to_path_buf();
    let current_version = manifest::MODEL_VERSION;
    tauri::async_runtime::spawn(async move {
        if let Ok(mut entries) = tokio::fs::read_dir(&parent).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if entry.file_name() != current_version {
                    download::uninstall_version(&entry.path()).await;
                }
            }
        }
    });

    Ok(())
}

/// Register the calling window as the active OCR chrome window so the
/// session's RAII teardown closes it automatically. The frontend invokes
/// this once the OCR chrome route mounts; closing the previous chrome
/// window (if any) is handled inside [`WindowMgr::set_ocr_chrome`].
#[tauri::command]
pub async fn ocr_register_chrome(
    state: tauri::State<'_, std::sync::Arc<crate::window_mgr::WindowMgr>>,
    window: Window,
) -> Result<(), String> {
    let label = window.label().to_string();
    let webview = window
        .app_handle()
        .get_webview_window(&label)
        .ok_or_else(|| format!("webview {label} not found"))?;
    state.set_ocr_chrome(webview);
    Ok(())
}

/// Prompt the user for a destination and write the OCR text to disk.
///
/// Mirrors the [`crate::saver`] pattern used by the screenshot save flow:
/// `rfd::AsyncFileDialog` to avoid blocking the Tokio runtime, and
/// `std::fs::write` for the write itself (we deliberately keep `tokio::fs`
/// off the dependency tree). Returns `Ok(())` for both successful saves and
/// user cancellation — the frontend distinguishes them via toast feedback.
#[tauri::command]
pub async fn ocr_save_text(text: String) -> Result<(), String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_file_name("ocr-result.txt")
        .add_filter("Text", &["txt"])
        .save_file()
        .await;

    let Some(handle) = handle else {
        // User cancelled the dialog; not an error.
        return Ok(());
    };

    let path = handle.path().to_path_buf();
    tokio::task::spawn_blocking(move || std::fs::write(path, text))
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}
