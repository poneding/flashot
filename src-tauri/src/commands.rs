use crate::{
    clipboard, overlay_window,
    pin_mgr::{PinEntry, PinManager},
    saver, settings_store,
    settings_store::Settings,
    types::Rect,
    window_mgr::WindowMgr,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt as _;
use uuid::Uuid;

const ABOUT_WINDOW_WIDTH: f64 = 360.0;
const ABOUT_WINDOW_HEIGHT: f64 = 300.0;
const SETTINGS_WINDOW_WIDTH: f64 = 560.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 560.0;
const UPDATER_WINDOW_WIDTH: f64 = 360.0;
const UPDATER_WINDOW_HEIGHT: f64 = 280.0;

/// Extra padding (logical px per side) added to pin windows so the CSS
/// boxShadow rendered by the frontend has room outside the image.
/// Must match `PIN_SHADOW_PADDING` in src/routes/Pin.tsx.
const PIN_SHADOW_PADDING: f64 = 24.0;

#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
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
    let final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    clipboard::copy_image(final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())?;
    mgr.end_session(&app);
    Ok(())
}

#[tauri::command]
pub async fn crop_and_save(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
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
    let final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    let mut settings = settings_store::load().unwrap_or_default();
    mgr.end_session(&app);
    let path = saver::save_image_dialog(
        final_image.rgba,
        final_image.width,
        final_image.height,
        &settings,
    )
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
    let (width, height) = settings_window_size();
    tauri::WebviewWindowBuilder::new(&app, "settings", url)
        .title("Flashot Settings")
        .inner_size(width, height)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn begin_text_input_session(window: WebviewWindow) -> Result<(), String> {
    overlay_window::prepare_overlay_text_input(&window).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_text_input_session(window: WebviewWindow) -> Result<(), String> {
    overlay_window::restore_overlay_after_text_input(&window).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn open_updater_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("updater") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/updater".into());
    tauri::WebviewWindowBuilder::new(&app, "updater", url)
        .title("Check for Updates")
        .inner_size(UPDATER_WINDOW_WIDTH, UPDATER_WINDOW_HEIGHT)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn about_window_size() -> (f64, f64) {
    (ABOUT_WINDOW_WIDTH, ABOUT_WINDOW_HEIGHT)
}

fn settings_window_size() -> (f64, f64) {
    (SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| {
            face.families
                .first()
                .map(|(name, _)| name.clone())
        })
        .collect();

    families.sort_unstable();
    families.dedup();
    families
}

#[tauri::command]
pub async fn pin_image(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<String, String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;

    let pin_id = Uuid::new_v4().to_string();
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let pins_dir = cache_dir.join("pins");
    std::fs::create_dir_all(&pins_dir).map_err(|e| e.to_string())?;

    let image_path = pins_dir.join(format!("pin-{}.png", pin_id));
    save_pin_png(&cropped.rgba, cropped.width, cropped.height, &image_path)?;

    let annotation_path = match annotation_png {
        Some(png_data) if !png_data.is_empty() => {
            let annotation_path = pins_dir.join(format!("pin-{}-annotation.png", pin_id));
            std::fs::write(&annotation_path, png_data)
                .map_err(|e| format!("Failed to save annotation PNG: {}", e))?;
            Some(annotation_path)
        }
        _ => None,
    };

    let window_label = format!("pin-{}", pin_id);
    let route = if annotation_path.is_some() {
        format!("index.html#/pin/{}?annotation=1", pin_id)
    } else {
        format!("index.html#/pin/{}", pin_id)
    };
    let url = tauri::WebviewUrl::App(route.into());

    let outer_width = rect.width as f64 + 2.0 * PIN_SHADOW_PADDING;
    let outer_height = rect.height as f64 + 2.0 * PIN_SHADOW_PADDING;

    // Position the pin window so the *image* lands exactly where the
    // user's selection was on screen. `rect` is in monitor-local logical
    // pixels; the window includes a PIN_SHADOW_PADDING ring on every side
    // for the glow, so we offset both axes by -PADDING. We also need the
    // monitor's global origin so multi-display setups land on the right
    // screen.
    let monitor_origin = crate::capture::enumerate_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.id == monitor_id))
        .map(|m| (m.rect.x as f64, m.rect.y as f64))
        .unwrap_or((0.0, 0.0));
    let pin_x = monitor_origin.0 + rect.x as f64 - PIN_SHADOW_PADDING;
    let pin_y = monitor_origin.1 + rect.y as f64 - PIN_SHADOW_PADDING;

    tauri::WebviewWindowBuilder::new(&app, &window_label, url)
        .title("")
        .inner_size(outer_width, outer_height)
        .position(pin_x, pin_y)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;

    pin_mgr.add_pin(PinEntry {
        id: pin_id.clone(),
        image_path,
        annotation_path,
        window_label,
        original_width: rect.width,
        original_height: rect.height,
        current_scale: 1.0,
    });

    mgr.end_session(&app);
    Ok(pin_id)
}

#[tauri::command]
pub async fn close_pin(
    pin_id: String,
    app: AppHandle,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let entry = pin_mgr.remove_pin(&pin_id).ok_or("pin not found")?;

    if let Some(window) = app.get_webview_window(&entry.window_label) {
        window.close().map_err(|e| e.to_string())?;
    }

    let _ = std::fs::remove_file(&entry.image_path);
    if let Some(annotation_path) = entry.annotation_path {
        let _ = std::fs::remove_file(annotation_path);
    }
    Ok(())
}

#[tauri::command]
pub async fn set_pin_scale(
    pin_id: String,
    scale: f64,
    app: AppHandle,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let mut entry = pin_mgr.get_pin(&pin_id).ok_or("pin not found")?;
    let clamped_scale = scale.clamp(0.5, 3.0);

    let new_width = entry.original_width as f64 * clamped_scale + 2.0 * PIN_SHADOW_PADDING;
    let new_height = entry.original_height as f64 * clamped_scale + 2.0 * PIN_SHADOW_PADDING;

    if let Some(window) = app.get_webview_window(&entry.window_label) {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: new_width,
                height: new_height,
            }))
            .map_err(|e| e.to_string())?;
    }

    entry.current_scale = clamped_scale;
    pin_mgr.add_pin(entry);
    Ok(())
}

fn save_pin_png(
    rgba: &[u8],
    width: u32,
    height: u32,
    path: &std::path::Path,
) -> Result<(), String> {
    let png = encode_pin_png(rgba, width, height)?;
    std::fs::write(path, png).map_err(|e| format!("Failed to save PNG: {}", e))
}

fn encode_pin_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::{
        codecs::png::{CompressionType, FilterType, PngEncoder},
        ExtendedColorType, ImageEncoder,
    };

    let mut png = Vec::with_capacity(rgba.len() + height as usize);
    PngEncoder::new_with_quality(
        &mut png,
        CompressionType::Uncompressed,
        FilterType::NoFilter,
    )
    .write_image(rgba, width, height, ExtendedColorType::Rgba8)
    .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    Ok(png)
}

pub(crate) struct CroppedImage {
    pub(crate) rgba: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

pub(crate) fn crop_rgba(
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

fn composite_annotation(
    base: &CroppedImage,
    annotation_png: &[u8],
) -> Result<CroppedImage, String> {
    use image::{imageops, ImageBuffer, RgbaImage};

    let mut base_img: RgbaImage = ImageBuffer::from_raw(base.width, base.height, base.rgba.clone())
        .ok_or("Failed to create base image buffer")?;

    let annotation_img =
        image::load_from_memory_with_format(annotation_png, image::ImageFormat::Png)
            .map_err(|e| format!("Failed to decode annotation PNG: {}", e))?
            .to_rgba8();

    // Resize annotation to match base if dimensions differ
    let annotation_resized =
        if annotation_img.width() != base.width || annotation_img.height() != base.height {
            imageops::resize(
                &annotation_img,
                base.width,
                base.height,
                imageops::FilterType::Lanczos3,
            )
        } else {
            annotation_img
        };

    imageops::overlay(&mut base_img, &annotation_resized, 0, 0);

    Ok(CroppedImage {
        rgba: base_img.into_raw(),
        width: base.width,
        height: base.height,
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
    fn pin_image_accepts_annotation_png_for_pin_route() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn pin_image").unwrap();
        let end = source[start..]
            .find("#[tauri::command]\npub async fn close_pin")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("annotation_png: Option<Vec<u8>>"),
            "pin_image must accept exported annotation PNG data",
        );
        assert!(
            body.contains("annotation_path"),
            "pin_image must persist annotation PNG data for the pin window",
        );
    }

    #[test]
    fn pin_image_stores_annotation_as_separate_layer_for_latency() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn pin_image").unwrap();
        let end = source[start..]
            .find("#[tauri::command]\npub async fn close_pin")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("annotation_path"),
            "pin_image should keep annotation PNGs as a separate pin-window layer",
        );
        assert!(
            body.contains("std::fs::write(&annotation_path, png_data)"),
            "pin_image should write the exported annotation PNG directly instead of decoding it",
        );
        assert!(
            body.contains("index.html#/pin/{}?annotation=1"),
            "pin route should know when to load an annotation layer",
        );
        assert!(
            !body.contains("composite_annotation(&cropped"),
            "pin_image should avoid synchronous annotation compositing before creating the pin window",
        );
    }

    #[test]
    fn pin_window_keeps_webview_visible_for_image_loading() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn pin_image").unwrap();
        let end = source[start..]
            .find("#[tauri::command]\npub async fn close_pin")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains(".shadow(false)"),
            "pin windows should not use native window shadows on top of the CSS glow",
        );
        assert!(
            !body.contains(".visible(false)"),
            "pin windows must stay visible so the webview can load image layers",
        );
    }

    #[test]
    fn pin_png_encoder_uses_low_latency_settings() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("fn save_pin_png").unwrap();
        let end = source[start..]
            .find("pub(crate) struct CroppedImage")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("PngEncoder::new_with_quality"),
            "pin PNGs are temporary UI assets and should use explicit encoder settings",
        );
        assert!(
            body.contains("CompressionType::Uncompressed"),
            "pin PNG encoding should favor low click-to-pin latency over small cache files",
        );
        assert!(
            body.contains("FilterType::NoFilter"),
            "pin PNG encoding should skip PNG filtering work",
        );
        assert!(
            body.contains(".write_image(rgba, width, height"),
            "pin PNG encoding should avoid copying RGBA into an ImageBuffer first",
        );
    }

    #[test]
    fn fast_pin_png_encoder_writes_decodable_rgba() {
        let rgba = vec![255, 0, 0, 255, 0, 128, 255, 255];

        let png = encode_pin_png(&rgba, 2, 1).expect("pin png should encode");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));

        let decoded = image::load_from_memory(&png)
            .expect("pin png should decode")
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.into_raw(), rgba);
    }

    #[test]
    fn about_window_has_vertical_room_for_content() {
        assert_eq!(about_window_size(), (360.0, 300.0));
    }

    #[test]
    fn settings_window_has_vertical_room_for_quick_shot_shortcuts() {
        assert_eq!(settings_window_size(), (560.0, 560.0));
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
