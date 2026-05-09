use crate::{clipboard, saver, settings_store, settings_store::Settings, types::Rect, window_mgr::WindowMgr};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(&frame.rgba, frame.width, frame.height, rect, frame.scale_factor)
        .ok_or("crop failed")?;
    clipboard::copy_image(cropped.rgba, cropped.width, cropped.height)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn crop_and_save(
    monitor_id: u32,
    rect: Rect,
    _app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(&frame.rgba, frame.width, frame.height, rect, frame.scale_factor)
        .ok_or("crop failed")?;
    let path = saver::save_image_dialog(cropped.rgba, cropped.width, cropped.height)
        .map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn cancel_capture(_app: AppHandle) -> Result<(), String> {
    // Intentionally a no-op — caller drops the SessionGuard, which ends the session.
    Ok(())
}

#[tauri::command]
pub fn get_settings(_app: AppHandle) -> Result<Settings, String> {
    settings_store::load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_settings(_app: AppHandle, settings: Settings) -> Result<(), String> {
    settings_store::save(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/settings".into());
    tauri::WebviewWindowBuilder::new(&app, "settings", url)
        .title("Flashot Settings")
        .inner_size(560.0, 420.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

struct CroppedImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

fn crop_rgba(
    src: &[u8],
    src_width: u32,
    src_height: u32,
    rect: Rect,
    scale_factor: f32,
) -> Option<CroppedImage> {
    let s = scale_factor.max(1.0);
    let px = (rect.x as f32 * s).round() as u32;
    let py = (rect.y as f32 * s).round() as u32;
    let pw = (rect.width as f32 * s).round() as u32;
    let ph = (rect.height as f32 * s).round() as u32;

    if pw == 0 || ph == 0 || px + pw > src_width || py + ph > src_height {
        return None;
    }

    let mut out = Vec::with_capacity((pw * ph * 4) as usize);
    for row in 0..ph {
        let src_row_start = ((py + row) * src_width + px) as usize * 4;
        let src_row_end = src_row_start + (pw as usize) * 4;
        out.extend_from_slice(&src[src_row_start..src_row_end]);
    }

    Some(CroppedImage {
        rgba: out,
        width: pw,
        height: ph,
    })
}
