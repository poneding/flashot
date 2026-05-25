//! Tauri command handlers for OCR install/status. The recognition command
//! lives in `commands.rs` at the crate root because it depends on `WindowMgr`.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

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

/// Spawn the OCR chrome window from Rust. We must create the window in Rust
/// because frontend-side `new WebviewWindow()` is blocked by Tauri 2 in
/// release builds (and would require permission wiring even where it works).
/// The window is anchored relative to the selection on the originating
/// monitor: prefer placement below the selection, then above, then a
/// last-resort bottom-of-monitor fallback.
#[tauri::command]
pub async fn open_ocr_chrome(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<crate::window_mgr::WindowMgr>>,
    monitor_id: u32,
    rect: crate::types::Rect,
) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    // Look up monitor info to compute the anchor in logical coordinates.
    let mon = crate::capture::enumerate_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.id == monitor_id))
        .ok_or_else(|| "monitor not found".to_string())?;

    let chrome_w = 400.0_f64;
    let chrome_h = 280.0_f64;
    let mon_logical_w = mon.rect.width as f64;
    let mon_logical_h = mon.rect.height as f64;
    let mon_origin_x = mon.rect.x as f64;
    let mon_origin_y = mon.rect.y as f64;

    // `rect` arrives in monitor-local logical coordinates from the frontend
    // (mirrors handleScroll and crop_and_copy callers).
    let sel_x = rect.x as f64;
    let sel_y = rect.y as f64;
    let sel_h = rect.height as f64;

    let gap = 8.0;

    // Anchor preference: below the selection, then above, then overlap.
    let (x, y) = if sel_y + sel_h + gap + chrome_h <= mon_logical_h {
        (
            (mon_origin_x + sel_x).clamp(mon_origin_x, mon_origin_x + mon_logical_w - chrome_w),
            mon_origin_y + sel_y + sel_h + gap,
        )
    } else if sel_y - gap - chrome_h >= 0.0 {
        (
            (mon_origin_x + sel_x).clamp(mon_origin_x, mon_origin_x + mon_logical_w - chrome_w),
            mon_origin_y + sel_y - gap - chrome_h,
        )
    } else {
        (
            (mon_origin_x + sel_x).clamp(mon_origin_x, mon_origin_x + mon_logical_w - chrome_w),
            mon_origin_y + (mon_logical_h - chrome_h - gap).max(gap),
        )
    };

    let session_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let chrome_label = format!("ocr-chrome-{session_id}");

    // URL-encode the rect JSON so '?' / '&' inside don't break the query string.
    let rect_json = serde_json::to_string(&rect).map_err(|e| e.to_string())?;
    let url = format!(
        "index.html#/ocr-chrome/{session_id}?monitorId={monitor_id}&rect={}",
        urlencoding::encode(&rect_json)
    );

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &chrome_label,
        tauri::WebviewUrl::App(url.into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .title("OCR")
    .inner_size(chrome_w, chrome_h)
    .position(x, y)
    .build()
    .map_err(|e| e.to_string())?;

    // Register so SessionGuard tears it down with the session.
    state.set_ocr_chrome(window);
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
