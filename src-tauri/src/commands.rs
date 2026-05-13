use crate::{
    clipboard, saver, settings_store, settings_store::Settings, types::Rect, window_mgr::WindowMgr,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;

const ABOUT_WINDOW_WIDTH: f64 = 360.0;
const ABOUT_WINDOW_HEIGHT: f64 = 300.0;

#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    clipboard::copy_image(cropped.rgba, cropped.width, cropped.height)
        .map_err(|e| e.to_string())?;
    mgr.end_session(&app);
    Ok(())
}

#[tauri::command]
pub async fn crop_and_save(
    monitor_id: u32,
    rect: Rect,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    let mut settings = settings_store::load().unwrap_or_default();
    mgr.end_session(&app);
    let path = saver::save_image_dialog(cropped.rgba, cropped.width, cropped.height, &settings)
        .map_err(|e| e.to_string())?;
    if path.is_some() {
        if let Some(saved_path) = path.as_deref() {
            saver::remember_last_save_dir(&mut settings, saved_path);
            settings_store::save(&settings).map_err(|e| e.to_string())?;
            let _ = app.emit("settings:changed", ());
        }
    }
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn cancel_capture(app: AppHandle, mgr: State<'_, Arc<WindowMgr>>) -> Result<(), String> {
    mgr.end_session(&app);
    Ok(())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let mut settings = settings_store::load().map_err(|e| e.to_string())?;
    settings.launch_at_login = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    apply_launch_at_login(&*autolaunch, settings.launch_at_login)?;
    settings_store::save(&settings).map_err(|e| e.to_string())?;
    let _ = app.emit("settings:changed", ());
    Ok(())
}

trait LaunchAtLogin {
    fn enable(&self) -> Result<(), String>;
    fn disable(&self) -> Result<(), String>;
}

impl LaunchAtLogin for tauri_plugin_autostart::AutoLaunchManager {
    fn enable(&self) -> Result<(), String> {
        tauri_plugin_autostart::AutoLaunchManager::enable(self).map_err(|e| e.to_string())
    }

    fn disable(&self) -> Result<(), String> {
        tauri_plugin_autostart::AutoLaunchManager::disable(self).map_err(|e| e.to_string())
    }
}

fn apply_launch_at_login(
    manager: &impl LaunchAtLogin,
    launch_at_login: bool,
) -> Result<(), String> {
    if launch_at_login {
        manager.enable()
    } else {
        manager.disable()
    }
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
pub fn open_about_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("about") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/about".into());
    let (width, height) = about_window_size();
    tauri::WebviewWindowBuilder::new(&app, "about", url)
        .title("About Flashot")
        .inner_size(width, height)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn about_window_size() -> (f64, f64) {
    (ABOUT_WINDOW_WIDTH, ABOUT_WINDOW_HEIGHT)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba_frame(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                out.extend_from_slice(&[x as u8, y as u8, (x + y) as u8, 255]);
            }
        }
        out
    }

    #[test]
    fn crop_rgba_scales_logical_selection_into_physical_frame() {
        let src = rgba_frame(200, 100);
        let cropped = crop_rgba(
            &src,
            200,
            100,
            Rect {
                x: 10,
                y: 5,
                width: 20,
                height: 10,
            },
            2.0,
        )
        .expect("logical rect should fit after scaling");

        assert_eq!(cropped.width, 40);
        assert_eq!(cropped.height, 20);
        assert_eq!(&cropped.rgba[0..4], &[20, 10, 30, 255]);
    }

    #[test]
    fn crop_rgba_accepts_full_logical_retina_monitor_when_frame_is_physical() {
        let src = rgba_frame(200, 100);
        let cropped = crop_rgba(
            &src,
            200,
            100,
            Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 50,
            },
            2.0,
        )
        .expect("full logical monitor should map to the full physical frame");

        assert_eq!(cropped.width, 200);
        assert_eq!(cropped.height, 100);
        assert_eq!(cropped.rgba.len(), 200 * 100 * 4);
    }

    #[test]
    fn crop_rgba_rejects_rects_outside_physical_frame() {
        let src = rgba_frame(200, 100);
        let cropped = crop_rgba(
            &src,
            200,
            100,
            Rect {
                x: 95,
                y: 0,
                width: 10,
                height: 10,
            },
            2.0,
        );

        assert!(cropped.is_none());
    }

    #[test]
    fn crop_and_save_ends_capture_before_opening_save_dialog() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn crop_and_save").unwrap();
        let end = source[start..]
            .find("#[tauri::command]\npub async fn cancel_capture")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        let crop_idx = body.find("let cropped = crop_rgba").unwrap();
        let end_session_idx = body.find("mgr.end_session(&app);").unwrap();
        let save_dialog_idx = body.find("saver::save_image_dialog").unwrap();

        assert!(
            crop_idx < end_session_idx,
            "the image must be cropped before ending capture so frames can be cleared",
        );
        assert!(
            end_session_idx < save_dialog_idx,
            "native save dialogs must open after overlay windows are hidden",
        );
    }

    #[test]
    fn about_window_has_vertical_room_for_content() {
        assert_eq!(about_window_size(), (360.0, 300.0));
    }

    #[derive(Default)]
    struct FakeLaunchAtLogin {
        calls: std::cell::RefCell<Vec<&'static str>>,
    }

    impl LaunchAtLogin for FakeLaunchAtLogin {
        fn enable(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("enable");
            Ok(())
        }

        fn disable(&self) -> Result<(), String> {
            self.calls.borrow_mut().push("disable");
            Ok(())
        }
    }

    #[test]
    fn apply_launch_at_login_enables_login_startup_when_requested() {
        let manager = FakeLaunchAtLogin::default();

        apply_launch_at_login(&manager, true).unwrap();

        assert_eq!(*manager.calls.borrow(), ["enable"]);
    }

    #[test]
    fn apply_launch_at_login_disables_login_startup_when_requested() {
        let manager = FakeLaunchAtLogin::default();

        apply_launch_at_login(&manager, false).unwrap();

        assert_eq!(*manager.calls.borrow(), ["disable"]);
    }

    #[test]
    fn set_settings_applies_launch_at_login_before_saving_settings() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub fn set_settings").unwrap();
        let end = source[start..]
            .find("#[tauri::command]\npub fn open_settings_window")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        let apply_idx = body.find("apply_launch_at_login").unwrap();
        let save_idx = body.find("settings_store::save").unwrap();

        assert!(
            apply_idx < save_idx,
            "login startup must be applied before settings are persisted",
        );
    }
}
