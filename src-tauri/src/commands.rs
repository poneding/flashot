use crate::{
    app_activation::schedule_app_deactivation_macos,
    clipboard, overlay_window,
    pin_mgr::{PinEntry, PinManager},
    saver, settings_store,
    settings_store::{Language, Settings, Theme as SettingsTheme},
    types::{ImageAdjustments, Rect},
    window_mgr::WindowMgr,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{
    window::Color, AppHandle, Emitter, Manager, State, Theme as TauriTheme, Url, WebviewWindow,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_updater::UpdaterExt as _;
use uuid::Uuid;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScrollResult {
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

const ABOUT_WINDOW_WIDTH: f64 = 360.0;
const ABOUT_WINDOW_HEIGHT: f64 = 300.0;
const SETTINGS_WINDOW_WIDTH: f64 = 560.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 560.0;
const UPDATER_WINDOW_WIDTH: f64 = 360.0;
const UPDATER_WINDOW_HEIGHT: f64 = 280.0;
const STABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/poneding/flashot/releases/latest/download/latest.json";
const BETA_UPDATE_ENDPOINT: &str =
    "https://raw.githubusercontent.com/poneding/flashot/beta/latest.json";
const UPDATER_PROGRESS_EVENT: &str = "updater:progress";
const MAX_CORNER_RADIUS: u32 = 60;
const UTILITY_WINDOW_LIGHT_BACKGROUND: Color = Color(255, 255, 255, 255);
const UTILITY_WINDOW_DARK_BACKGROUND: Color = Color(11, 17, 30, 255);
const UTILITY_WINDOW_DARK_INIT_SCRIPT: &str = r#"
(() => {
  try {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  } catch (_) {}
})();
"#;
const UTILITY_WINDOW_LIGHT_INIT_SCRIPT: &str = r#"
(() => {
  try {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  } catch (_) {}
})();
"#;
const UTILITY_WINDOW_SYSTEM_INIT_SCRIPT: &str = r#"
(() => {
  try {
    localStorage.setItem("theme", "system");
    const dark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (_) {}
})();
"#;

/// Extra padding (logical px per side) added to pin windows so the CSS
/// boxShadow rendered by the frontend has room outside the image.
/// Must match `PIN_SHADOW_PADDING` in src/routes/Pin.tsx.
const PIN_SHADOW_PADDING: f64 = 24.0;
/// Transparent right-side gutter reserved so the pin controls can sit
/// outside the image without adding a left frame.
/// Must match `PIN_CONTROLS_SIDE_RESERVE` in src/routes/Pin.tsx.
const PIN_CONTROLS_SIDE_RESERVE: f64 = 48.0;
/// Transparent bottom gutter reserved so the annotation toolbar can sit
/// outside the image at the lower-left of the pin window.
/// Must match `PIN_TOOLBAR_BOTTOM_RESERVE` in src/routes/Pin.tsx.
const PIN_TOOLBAR_BOTTOM_RESERVE: f64 = 48.0;

fn clamp_corner_radius(radius: u32) -> u32 {
    radius.min(MAX_CORNER_RADIUS)
}

fn show_pin_window(window: &WebviewWindow) -> Result<(), String> {
    configure_pin_window_before_show(window)?;
    window
        .show()
        .map_err(|e| format!("Failed to show pin window: {e}"))
}

fn show_app_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .unminimize()
        .map_err(|e| format!("Failed to unminimize app window: {e}"))?;
    window
        .show()
        .map_err(|e| format!("Failed to show app window: {e}"))?;
    bring_app_window_to_front(window)
}

fn show_utility_window(window: &WebviewWindow, theme: Option<TauriTheme>) -> Result<(), String> {
    apply_utility_window_appearance(window, theme)?;
    show_app_window(window)
}

fn utility_window_theme_for_settings(settings: &Settings) -> Option<TauriTheme> {
    match settings.theme {
        SettingsTheme::Dark => Some(TauriTheme::Dark),
        SettingsTheme::Light => Some(TauriTheme::Light),
        SettingsTheme::System => None,
    }
}

fn stored_utility_window_preferences() -> (Option<TauriTheme>, Language) {
    let settings = settings_store::load().unwrap_or_default();
    (
        utility_window_theme_for_settings(&settings),
        settings.language,
    )
}

fn utility_window_background_color(theme: TauriTheme) -> Color {
    match theme {
        TauriTheme::Dark => UTILITY_WINDOW_DARK_BACKGROUND,
        TauriTheme::Light => UTILITY_WINDOW_LIGHT_BACKGROUND,
        _ => UTILITY_WINDOW_LIGHT_BACKGROUND,
    }
}

fn utility_window_initial_background(theme: Option<TauriTheme>) -> Color {
    theme
        .map(utility_window_background_color)
        .unwrap_or(UTILITY_WINDOW_LIGHT_BACKGROUND)
}

fn utility_window_init_script(theme: Option<TauriTheme>) -> &'static str {
    match theme {
        Some(TauriTheme::Dark) => UTILITY_WINDOW_DARK_INIT_SCRIPT,
        Some(TauriTheme::Light) => UTILITY_WINDOW_LIGHT_INIT_SCRIPT,
        _ => UTILITY_WINDOW_SYSTEM_INIT_SCRIPT,
    }
}

fn apply_utility_window_appearance(
    window: &WebviewWindow,
    theme: Option<TauriTheme>,
) -> Result<(), String> {
    window
        .set_theme(theme)
        .map_err(|e| format!("Failed to set utility window theme: {e}"))?;

    let effective_theme = theme
        .or_else(|| window.theme().ok())
        .unwrap_or(TauriTheme::Light);
    window
        .set_background_color(Some(utility_window_background_color(effective_theme)))
        .map_err(|e| format!("Failed to set utility window background: {e}"))
}

#[cfg(target_os = "macos")]
fn bring_app_window_to_front(window: &WebviewWindow) -> Result<(), String> {
    if macos_is_main_thread() {
        return bring_macos_app_window_to_front(window);
    }

    let task_window = window.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    window
        .run_on_main_thread(move || {
            let result = bring_macos_app_window_to_front(&task_window);
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.recv()
        .map_err(|_| "bring app window to front did not return from the main thread".to_string())?
}

#[cfg(target_os = "macos")]
fn macos_is_main_thread() -> bool {
    use objc::{
        runtime::{Class, Sel, BOOL, YES},
        Message,
    };

    unsafe {
        let Some(thread_class) = Class::get("NSThread") else {
            return false;
        };
        match thread_class.send_message::<_, BOOL>(Sel::register("isMainThread"), ()) {
            Ok(is_main) => is_main == YES,
            Err(e) => {
                tracing::warn!("NSThread isMainThread failed: {e}");
                false
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn bring_macos_app_window_to_front(window: &WebviewWindow) -> Result<(), String> {
    use objc::{
        runtime::{Class, Object, Sel, YES},
        Message,
    };

    let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    unsafe {
        let ns_window = &*ns_window;
        ns_window
            .send_message::<_, ()>(Sel::register("orderFrontRegardless"), ())
            .map_err(|e| e.to_string())?;

        if let Some(app_class) = Class::get("NSApplication") {
            let app: *mut Object = app_class
                .send_message(Sel::register("sharedApplication"), ())
                .map_err(|e| e.to_string())?;
            if !app.is_null() {
                (*app)
                    .send_message::<_, ()>(Sel::register("activateIgnoringOtherApps:"), (YES,))
                    .map_err(|e| e.to_string())?;
            }
        }

        ns_window
            .send_message::<_, ()>(
                Sel::register("makeKeyAndOrderFront:"),
                (std::ptr::null_mut::<Object>(),),
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn bring_app_window_to_front(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus app window: {e}"))
}

#[cfg(target_os = "macos")]
fn configure_pin_window_before_show(window: &WebviewWindow) -> Result<(), String> {
    let task_window = window.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    window
        .run_on_main_thread(move || {
            let result = configure_macos_pin_window_before_show(&task_window);
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.recv()
        .map_err(|_| "configure pin window did not return from the main thread".to_string())?
}

#[cfg(target_os = "macos")]
fn configure_macos_pin_window_before_show(window: &WebviewWindow) -> Result<(), String> {
    use objc::{
        runtime::{Object, Sel, NO},
        Message,
    };

    // NSWindowAnimationBehaviorNone. Keep the raw value local so the
    // Cocoa dependency stays lightweight and this remains easy to audit.
    const NS_WINDOW_ANIMATION_BEHAVIOR_NONE: usize = 2;

    let ns_window = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    unsafe {
        let ns_window = &*ns_window;
        ns_window
            .send_message::<_, ()>(
                Sel::register("setAnimationBehavior:"),
                (NS_WINDOW_ANIMATION_BEHAVIOR_NONE,),
            )
            .map_err(|e| e.to_string())?;
        ns_window
            .send_message::<_, ()>(Sel::register("setHasShadow:"), (NO,))
            .map_err(|e| e.to_string())?;
        ns_window
            .send_message::<_, ()>(Sel::register("setOpaque:"), (NO,))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn configure_pin_window_before_show(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    corner_radius: u32,
    adjustments: Option<ImageAdjustments>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let corner_radius = clamp_corner_radius(corner_radius);
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let mut cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    crate::image_adjust::apply_image_adjustments(
        &mut cropped.rgba,
        cropped.width,
        cropped.height,
        adjustments.unwrap_or_default(),
    );
    let mut final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    crate::mask::apply_rounded_corners(
        &mut final_image.rgba,
        final_image.width,
        final_image.height,
        corner_radius,
        frame.scale_factor,
    );
    clipboard::copy_image(final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())?;
    mgr.end_session_deactivating_app(&app);
    Ok(())
}

#[tauri::command]
pub async fn crop_and_save(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    corner_radius: u32,
    adjustments: Option<ImageAdjustments>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let corner_radius = clamp_corner_radius(corner_radius);
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let mut cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    crate::image_adjust::apply_image_adjustments(
        &mut cropped.rgba,
        cropped.width,
        cropped.height,
        adjustments.unwrap_or_default(),
    );
    let mut final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    crate::mask::apply_rounded_corners(
        &mut final_image.rgba,
        final_image.width,
        final_image.height,
        corner_radius,
        frame.scale_factor,
    );
    let mut settings = settings_store::load().unwrap_or_default();
    mgr.end_session(&app);
    let path = saver::save_image_dialog(
        final_image.rgba,
        final_image.width,
        final_image.height,
        &settings,
    );
    schedule_app_deactivation_macos(&app);
    let path = path.map_err(|e| e.to_string())?;
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
    if let Some(mid) = mgr.scroll_ref(|s| s.monitor_id) {
        close_scroll_chrome(&app, mid);
    }
    mgr.end_session_deactivating_app(&app);
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

#[tauri::command]
pub fn choose_default_save_dir(current_dir: Option<String>) -> Result<Option<String>, String> {
    saver::choose_directory(current_dir.as_deref())
        .map(|path| path.map(|path| path.to_string_lossy().to_string()))
        .map_err(|e| e.to_string())
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

fn update_endpoints(allow_beta: bool) -> Result<Vec<Url>, String> {
    let mut endpoints = Vec::new();
    if allow_beta {
        endpoints.push(Url::parse(BETA_UPDATE_ENDPOINT).map_err(|e| {
            format!("Invalid updater endpoint {BETA_UPDATE_ENDPOINT}: {e}")
        })?);
    }
    endpoints.push(Url::parse(STABLE_UPDATE_ENDPOINT).map_err(|e| {
        format!("Invalid updater endpoint {STABLE_UPDATE_ENDPOINT}: {e}")
    })?);
    Ok(endpoints)
}

async fn update_for_channel(
    app: &AppHandle,
    allow_beta: bool,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let updater = app
        .updater_builder()
        .endpoints(update_endpoints(allow_beta)?)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    updater.check().await.map_err(|e| e.to_string())
}

impl From<tauri_plugin_updater::Update> for UpdateInfo {
    fn from(update: tauri_plugin_updater::Update) -> Self {
        Self {
            version: update.version,
            body: update.body,
            date: update.date.map(|date| date.to_string()),
        }
    }
}

#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    allow_beta: bool,
) -> Result<Option<UpdateInfo>, String> {
    Ok(update_for_channel(&app, allow_beta).await?.map(Into::into))
}

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle, allow_beta: bool) -> Result<(), String> {
    let Some(update) = update_for_channel(&app, allow_beta).await? else {
        return Ok(());
    };

    let downloaded = Arc::new(AtomicU64::new(0));
    let progress_downloaded = downloaded.clone();
    let progress_app = app.clone();
    let finish_app = app.clone();
    let finish_downloaded = downloaded.clone();

    update
        .download_and_install(
            move |chunk_len, total| {
                let downloaded = progress_downloaded.fetch_add(chunk_len as u64, Ordering::Relaxed)
                    + chunk_len as u64;
                let _ =
                    progress_app.emit(UPDATER_PROGRESS_EVENT, UpdateProgress { downloaded, total });
            },
            move || {
                let downloaded = finish_downloaded.load(Ordering::Relaxed);
                let _ = finish_app.emit(
                    UPDATER_PROGRESS_EVENT,
                    UpdateProgress {
                        downloaded,
                        total: Some(downloaded),
                    },
                );
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) -> Result<(), String> {
    let (theme, language) = stored_utility_window_preferences();
    let title = crate::i18n::native_text(language).settings_title;
    if let Some(w) = app.get_webview_window("settings") {
        w.set_title(title)
            .map_err(|e| format!("Failed to set utility window title: {e}"))?;
        show_utility_window(&w, theme)?;
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/settings".into());
    let (width, height) = settings_window_size();
    let window = tauri::WebviewWindowBuilder::new(&app, "settings", url)
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .visible(false)
        .theme(theme)
        .background_color(utility_window_initial_background(theme))
        .initialization_script(utility_window_init_script(theme))
        .build()
        .map_err(|e| e.to_string())?;
    show_utility_window(&window, theme)?;
    Ok(())
}

#[tauri::command]
pub fn begin_text_input_session(window: WebviewWindow) -> Result<(), String> {
    // Release the session-scoped X/C hotkeys so they can be typed into the
    // annotation text field (macOS-only; no-op elsewhere).
    crate::set_color_picker_hotkeys(window.app_handle(), false);
    overlay_window::prepare_overlay_text_input(&window).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn end_text_input_session(
    window: WebviewWindow,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    // Re-arm the color picker hotkeys only while a capture session is still
    // active; otherwise leave them unregistered.
    if mgr.in_session() {
        crate::set_color_picker_hotkeys(window.app_handle(), true);
    }
    overlay_window::restore_overlay_after_text_input(&window).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_about_window(app: AppHandle) -> Result<(), String> {
    let (theme, language) = stored_utility_window_preferences();
    let title = crate::i18n::native_text(language).about_title;
    if let Some(w) = app.get_webview_window("about") {
        w.set_title(title)
            .map_err(|e| format!("Failed to set utility window title: {e}"))?;
        show_utility_window(&w, theme)?;
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/about".into());
    let (width, height) = about_window_size();
    let window = tauri::WebviewWindowBuilder::new(&app, "about", url)
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .visible(false)
        .theme(theme)
        .background_color(utility_window_initial_background(theme))
        .initialization_script(utility_window_init_script(theme))
        .build()
        .map_err(|e| e.to_string())?;
    show_utility_window(&window, theme)?;
    Ok(())
}

#[tauri::command]
pub fn open_updater_window(app: AppHandle) -> Result<(), String> {
    let (theme, language) = stored_utility_window_preferences();
    let title = crate::i18n::native_text(language).updates_title;
    if let Some(w) = app.get_webview_window("updater") {
        w.set_title(title)
            .map_err(|e| format!("Failed to set utility window title: {e}"))?;
        show_utility_window(&w, theme)?;
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/updater".into());
    let window = tauri::WebviewWindowBuilder::new(&app, "updater", url)
        .title(title)
        .inner_size(UPDATER_WINDOW_WIDTH, UPDATER_WINDOW_HEIGHT)
        .resizable(false)
        .visible(false)
        .theme(theme)
        .background_color(utility_window_initial_background(theme))
        .initialization_script(utility_window_init_script(theme))
        .build()
        .map_err(|e| e.to_string())?;
    show_utility_window(&window, theme)?;
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
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .collect();

    families.sort_unstable();
    families.dedup();
    families
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pin_image(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    corner_radius: u32,
    adjustments: Option<ImageAdjustments>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<String, String> {
    let corner_radius = clamp_corner_radius(corner_radius);
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let mut cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    crate::image_adjust::apply_image_adjustments(
        &mut cropped.rgba,
        cropped.width,
        cropped.height,
        adjustments.unwrap_or_default(),
    );
    crate::mask::apply_rounded_corners(
        &mut cropped.rgba,
        cropped.width,
        cropped.height,
        corner_radius,
        frame.scale_factor,
    );

    let pin_id = create_pin_from_image(
        &app,
        &pin_mgr,
        monitor_id,
        rect,
        cropped,
        annotation_png,
        corner_radius,
    )?;
    mgr.end_session_deactivating_app(&app);
    Ok(pin_id)
}

fn create_pin_from_image(
    app: &AppHandle,
    pin_mgr: &Arc<PinManager>,
    monitor_id: u32,
    display_rect: Rect,
    image: CroppedImage,
    annotation_png: Option<Vec<u8>>,
    corner_radius: u32,
) -> Result<String, String> {
    let pin_id = Uuid::new_v4().to_string();
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let pins_dir = cache_dir.join("pins");
    std::fs::create_dir_all(&pins_dir).map_err(|e| e.to_string())?;

    let image_path = pins_dir.join(format!("pin-{}.png", pin_id));
    save_pin_png(&image.rgba, image.width, image.height, &image_path)?;

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
    let mut route = if annotation_path.is_some() {
        format!("index.html#/pin/{}?annotation=1", pin_id)
    } else {
        format!("index.html#/pin/{}", pin_id)
    };
    if corner_radius > 0 {
        if route.contains('?') {
            route.push_str(&format!("&radius={corner_radius}"));
        } else {
            route.push_str(&format!("?radius={corner_radius}"));
        }
    }
    let url = tauri::WebviewUrl::App(route.into());

    let outer_width =
        display_rect.width as f64 + 2.0 * PIN_SHADOW_PADDING + PIN_CONTROLS_SIDE_RESERVE;
    let outer_height =
        display_rect.height as f64 + 2.0 * PIN_SHADOW_PADDING + PIN_TOOLBAR_BOTTOM_RESERVE;

    // Position the pin window so the *image* lands exactly where the user's
    // selection was on screen. `display_rect` is in monitor-local logical
    // pixels; the window includes a PIN_SHADOW_PADDING ring on every side for
    // the glow plus right/bottom gutters for controls. Since the image starts
    // after the left/top shadow padding, only those sides affect the window
    // origin. We also need the monitor's global origin so multi-display setups
    // land on the right screen.
    let monitor_origin = crate::capture::enumerate_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.id == monitor_id))
        .map(|m| (m.rect.x as f64, m.rect.y as f64))
        .unwrap_or((0.0, 0.0));
    let pin_x = monitor_origin.0 + display_rect.x as f64 - PIN_SHADOW_PADDING;
    let pin_y = monitor_origin.1 + display_rect.y as f64 - PIN_SHADOW_PADDING;

    let window = tauri::WebviewWindowBuilder::new(app, &window_label, url)
        .title("")
        .inner_size(outer_width, outer_height)
        .position(pin_x, pin_y)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    show_pin_window(&window)?;

    pin_mgr.add_pin(PinEntry {
        id: pin_id.clone(),
        image_path,
        annotation_path,
        window_label,
        original_width: display_rect.width,
        original_height: display_rect.height,
        current_scale: 1.0,
    });

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
    let entry = pin_mgr.get_pin(&pin_id).ok_or("pin not found")?;
    let clamped_scale = scale.clamp(0.5, 3.0);

    let new_width = entry.original_width as f64 * clamped_scale
        + 2.0 * PIN_SHADOW_PADDING
        + PIN_CONTROLS_SIDE_RESERVE;
    let new_height = entry.original_height as f64 * clamped_scale
        + 2.0 * PIN_SHADOW_PADDING
        + PIN_TOOLBAR_BOTTOM_RESERVE;

    if let Some(window) = app.get_webview_window(&entry.window_label) {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize {
                width: new_width,
                height: new_height,
            }))
            .map_err(|e| e.to_string())?;
    }

    pin_mgr
        .update_scale(&pin_id, clamped_scale)
        .ok_or("pin not found")?;
    Ok(())
}

#[tauri::command]
pub async fn update_pin_annotation(
    pin_id: String,
    annotation_png: Option<Vec<u8>>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let paths = pin_mgr.pin_paths(&pin_id).ok_or("pin not found")?;

    match annotation_png {
        Some(png_data) if !png_data.is_empty() => {
            let next_annotation_path = annotation_path_for_pin(&paths.image_path, &pin_id)?;
            let next_annotation_png =
                merge_pin_annotation_layers(paths.annotation_path.as_deref(), &png_data)?;
            std::fs::write(&next_annotation_path, next_annotation_png)
                .map_err(|e| format!("Failed to save annotation PNG: {e}"))?;

            if let Some(old_path) = paths.annotation_path.as_ref() {
                if old_path != &next_annotation_path {
                    let _ = std::fs::remove_file(old_path);
                }
            }

            pin_mgr
                .update_annotation(&pin_id, Some(next_annotation_path))
                .ok_or("pin not found")?;
        }
        _ => {
            if let Some(old_path) = paths.annotation_path {
                let _ = std::fs::remove_file(old_path);
            }

            pin_mgr
                .update_annotation(&pin_id, None)
                .ok_or("pin not found")?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn save_pin(
    pin_id: String,
    annotation_png: Option<Vec<u8>>,
    adjustments: Option<ImageAdjustments>,
    app: AppHandle,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<Option<String>, String> {
    let paths = pin_mgr.pin_paths(&pin_id).ok_or("pin not found")?;
    let final_image = compose_pin_image(
        &paths.image_path,
        paths.annotation_path.as_deref(),
        annotation_png.as_deref(),
        adjustments.unwrap_or_default(),
    )?;
    let mut settings = settings_store::load().unwrap_or_default();
    let path = saver::save_image_dialog(
        final_image.rgba,
        final_image.width,
        final_image.height,
        &settings,
    )
    .map_err(|e| e.to_string())?;

    if let Some(saved_path) = path.as_deref() {
        saver::remember_last_save_dir(&mut settings, saved_path);
        settings_store::save(&settings).map_err(|e| e.to_string())?;
        let _ = app.emit("settings:changed", ());
    }

    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn copy_pin(
    pin_id: String,
    annotation_png: Option<Vec<u8>>,
    adjustments: Option<ImageAdjustments>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let paths = pin_mgr.pin_paths(&pin_id).ok_or("pin not found")?;
    let final_image = compose_pin_image(
        &paths.image_path,
        paths.annotation_path.as_deref(),
        annotation_png.as_deref(),
        adjustments.unwrap_or_default(),
    )?;

    clipboard::copy_image(final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())
}

fn annotation_path_for_pin(image_path: &Path, pin_id: &str) -> Result<std::path::PathBuf, String> {
    let parent = image_path
        .parent()
        .ok_or("pin image path has no parent directory")?;
    Ok(parent.join(format!("pin-{pin_id}-annotation.png")))
}

fn merge_pin_annotation_layers(
    stored_annotation_path: Option<&Path>,
    annotation_png: &[u8],
) -> Result<Vec<u8>, String> {
    if annotation_png.is_empty() {
        return Ok(Vec::new());
    }

    let Some(path) = stored_annotation_path else {
        return Ok(annotation_png.to_vec());
    };

    use image::{imageops, RgbaImage};

    let stored_png =
        std::fs::read(path).map_err(|e| format!("Failed to read pin annotation PNG: {e}"))?;
    let stored_img: RgbaImage =
        image::load_from_memory_with_format(&stored_png, image::ImageFormat::Png)
            .map_err(|e| format!("Failed to decode stored annotation PNG: {e}"))?
            .to_rgba8();
    let next_img = image::load_from_memory_with_format(annotation_png, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to decode annotation PNG: {e}"))?
        .to_rgba8();
    let target_width = stored_img.width().max(next_img.width());
    let target_height = stored_img.height().max(next_img.height());

    let mut stored_img =
        if stored_img.width() != target_width || stored_img.height() != target_height {
            imageops::resize(
                &stored_img,
                target_width,
                target_height,
                imageops::FilterType::Lanczos3,
            )
        } else {
            stored_img
        };

    let next_resized = if next_img.width() != target_width || next_img.height() != target_height {
        imageops::resize(
            &next_img,
            target_width,
            target_height,
            imageops::FilterType::Lanczos3,
        )
    } else {
        next_img
    };

    imageops::overlay(&mut stored_img, &next_resized, 0, 0);
    let (width, height) = stored_img.dimensions();
    let merged = stored_img.into_raw();
    encode_pin_png(&merged, width, height)
}

fn compose_pin_image(
    image_path: &Path,
    stored_annotation_path: Option<&Path>,
    annotation_png: Option<&[u8]>,
    adjustments: ImageAdjustments,
) -> Result<CroppedImage, String> {
    let mut composed = load_pin_image(image_path)?;
    crate::image_adjust::apply_image_adjustments(
        &mut composed.rgba,
        composed.width,
        composed.height,
        adjustments,
    );

    if let Some(path) = stored_annotation_path {
        let png_data =
            std::fs::read(path).map_err(|e| format!("Failed to read pin annotation PNG: {e}"))?;
        composed = composite_annotation(&composed, &png_data)?;
    }

    if let Some(png_data) = annotation_png.filter(|data| !data.is_empty()) {
        composed = composite_annotation(&composed, png_data)?;
    }

    Ok(composed)
}

fn load_pin_image(path: &Path) -> Result<CroppedImage, String> {
    let image = image::open(path)
        .map_err(|e| format!("Failed to read pin image: {e}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    Ok(CroppedImage {
        rgba: image.into_raw(),
        width,
        height,
    })
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

#[tauri::command]
pub async fn start_scroll_session(
    monitor_id: u32,
    rect: Rect,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    use crate::scroll_stitch::{ScrollStitcher, StitchConfig};
    use crate::window_mgr::ScrollState;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::Mutex as AsyncMutex;

    // 1. Derive scale and physical rect from the frozen frame we already have.
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let scale = frame.scale_factor.max(1.0);
    let phys_rect = Rect {
        x: (rect.x as f32 * scale).round() as i32,
        y: (rect.y as f32 * scale).round() as i32,
        width: (rect.width as f32 * scale).round() as u32,
        height: (rect.height as f32 * scale).round() as u32,
    };

    // 2. Spawn the chrome window (status bar + preview) anchored next to the
    //    selection. The original overlay stays VISIBLE (so the user sees the
    //    selection outline) but is made mouse-transparent and the whole app
    //    is deactivated on macOS so scroll-wheel events flow to the underlying
    //    app instead of being intercepted by our key window.
    spawn_scroll_chrome(&app, monitor_id, phys_rect)?;
    if let Some(w) = app.get_webview_window(&format!("overlay-{monitor_id}")) {
        let _ = w.set_ignore_cursor_events(true);
    }
    schedule_app_deactivation_macos(&app);

    // 3. Give macOS a moment to actually compose the screen without the
    //    frozen overlay layer (frontend hides FrozenLayer when entering
    //    scrolling mode). Empirically 80ms is enough.
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    // 4. Capture the initial frame from the live screen.
    let initial = match crate::capture::capture_monitor_region(monitor_id, phys_rect) {
        Ok(initial) => initial,
        Err(e) => {
            close_scroll_chrome(&app, monitor_id);
            return Err(format!("initial capture failed: {e}"));
        }
    };

    let stitcher = Arc::new(AsyncMutex::new(ScrollStitcher::new(
        phys_rect.width,
        phys_rect.height,
        initial,
        StitchConfig::default(),
    )));
    let cancel = Arc::new(AtomicBool::new(false));

    {
        let s = stitcher.lock().await;
        crate::scroll_session::emit_initial_progress(&app, &s);
    }

    crate::scroll_session::spawn_loop(
        app.clone(),
        monitor_id,
        phys_rect,
        stitcher.clone(),
        cancel.clone(),
    );

    mgr.set_scroll(ScrollState {
        monitor_id,
        rect: phys_rect,
        logical_rect: rect,
        stitcher,
        cancel,
    });
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct LogicalChromePosition {
    x: f64,
    y: f64,
}

const SCROLL_CHROME_WIDTH: f64 = 280.0;
const SCROLL_CHROME_MIN_HEIGHT: f64 = 160.0;

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        return min;
    }
    value.max(min).min(max)
}

fn scroll_chrome_size(selection: Rect, monitor: Rect, gap: f64) -> (f64, f64) {
    let max_w = (monitor.width as f64 - gap * 2.0).max(1.0);
    let max_h = (monitor.height as f64 - gap * 2.0).max(1.0);
    let min_h = SCROLL_CHROME_MIN_HEIGHT.min(max_h);
    let width = SCROLL_CHROME_WIDTH.min(max_w);
    let aspect_height = (selection.height as f64 * width / selection.width.max(1) as f64).round();
    let height = clamp_f64(aspect_height, min_h, max_h);

    (width, height)
}

fn scroll_chrome_position(
    selection: Rect,
    monitor: Rect,
    chrome_size: (f64, f64),
    gap: f64,
) -> LogicalChromePosition {
    let chrome_w = chrome_size.0;
    let chrome_h = chrome_size.1;
    let monitor_left = monitor.x as f64;
    let monitor_top = monitor.y as f64;
    let monitor_right = monitor_left + monitor.width as f64;
    let monitor_bottom = monitor_top + monitor.height as f64;
    let selection_left = monitor_left + selection.x as f64;
    let selection_top = monitor_top + selection.y as f64;
    let selection_right = selection_left + selection.width as f64;
    let selection_bottom = selection_top + selection.height as f64;
    let lower_top = clamp_f64(
        selection_bottom - chrome_h,
        monitor_top + gap,
        monitor_bottom - chrome_h - gap,
    );

    let right_x = selection_right + gap;
    if right_x + chrome_w <= monitor_right - gap {
        return LogicalChromePosition {
            x: right_x,
            y: lower_top,
        };
    }

    let left_x = selection_left - chrome_w - gap;
    if left_x >= monitor_left + gap {
        return LogicalChromePosition {
            x: left_x,
            y: lower_top,
        };
    }

    LogicalChromePosition {
        x: clamp_f64(
            selection_right + gap,
            monitor_left + gap,
            monitor_right - chrome_w - gap,
        ),
        y: lower_top,
    }
}

fn logical_selection_for_monitor(phys_rect: Rect, scale_factor: f64) -> Rect {
    let scale = scale_factor.max(1.0);
    Rect {
        x: (phys_rect.x as f64 / scale).round() as i32,
        y: (phys_rect.y as f64 / scale).round() as i32,
        width: (phys_rect.width as f64 / scale).round().max(1.0) as u32,
        height: (phys_rect.height as f64 / scale).round().max(1.0) as u32,
    }
}

/// Spawn the always-on-top chrome window that hosts the live scroll preview.
/// The window prefers the lower-right side of the selection, flips to the
/// lower-left side near screen edges, then clamps inside the monitor.
fn spawn_scroll_chrome(app: &AppHandle, monitor_id: u32, phys_rect: Rect) -> Result<(), String> {
    let chrome_label = format!("overlay-chrome-{monitor_id}");
    if app.get_webview_window(&chrome_label).is_some() {
        return Ok(());
    }

    let mon = crate::capture::enumerate_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.id == monitor_id))
        .ok_or("monitor not found for chrome window")?;

    let gap = 12.0;
    let logical_selection = logical_selection_for_monitor(phys_rect, mon.scale_factor as f64);
    let (chrome_w, chrome_h) = scroll_chrome_size(logical_selection, mon.rect, gap);
    let pos = scroll_chrome_position(logical_selection, mon.rect, (chrome_w, chrome_h), gap);

    tauri::WebviewWindowBuilder::new(
        app,
        &chrome_label,
        tauri::WebviewUrl::App(format!("index.html#/scroll-chrome/{monitor_id}").into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .accept_first_mouse(true)
    .inner_size(chrome_w, chrome_h)
    .position(pos.x, pos.y)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Tear down the chrome window for `monitor_id` (if any) and restore mouse
/// events on the underlying overlay so the next capture session works.
fn close_scroll_chrome(app: &AppHandle, monitor_id: u32) {
    if let Some(w) = app.get_webview_window(&format!("overlay-chrome-{monitor_id}")) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(&format!("overlay-{monitor_id}")) {
        let _ = w.set_ignore_cursor_events(false);
    }
}

#[tauri::command]
pub async fn stop_scroll_session(
    commit: bool,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<ScrollResult>, String> {
    // Grab the cancel handle + stitcher Arc clones without taking the state out.
    let (cancel, stitcher_arc) = mgr
        .scroll_ref(|s| (s.cancel.clone(), s.stitcher.clone()))
        .ok_or("no active scroll session")?;
    cancel.store(true, std::sync::atomic::Ordering::SeqCst);

    if !commit {
        if let Some(mid) = mgr.scroll_ref(|s| s.monitor_id) {
            close_scroll_chrome(&app, mid);
        }
        let _ = mgr.take_scroll();
        mgr.end_session_deactivating_app(&app);
        return Ok(None);
    }

    let (width, height, frame_count) = {
        let s = stitcher_arc.lock().await;
        (s.width(), s.height(), s.frame_count())
    };

    Ok(Some(ScrollResult {
        width,
        height,
        frame_count,
    }))
}

#[tauri::command]
pub async fn scroll_pin(
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<String, String> {
    let (monitor_id, logical_rect) = mgr
        .scroll_ref(|s| (s.monitor_id, s.logical_rect))
        .ok_or("no active scroll session")?;
    let img = materialize_scroll_image(&mgr).await?;
    let _ = mgr.take_scroll();
    close_scroll_chrome(&app, monitor_id);

    let display_scale = if logical_rect.width > 0 {
        (img.width as f64 / logical_rect.width as f64).max(1.0)
    } else {
        1.0
    };
    let display_height = ((img.height as f64 / display_scale).round()).max(1.0) as u32;
    let display_rect = Rect {
        x: logical_rect.x,
        y: logical_rect.y,
        width: logical_rect.width.max(1),
        height: display_height,
    };
    let pin_id = create_pin_from_image(
        &app,
        &pin_mgr,
        monitor_id,
        display_rect,
        CroppedImage {
            rgba: img.rgba,
            width: img.width,
            height: img.height,
        },
        None,
        0,
    );
    mgr.end_session_deactivating_app(&app);
    pin_id
}

async fn materialize_scroll_image(
    mgr: &WindowMgr,
) -> Result<crate::scroll_stitch::StitchedImage, String> {
    let (cancel, stitcher_arc) = mgr
        .scroll_ref(|s| (s.cancel.clone(), s.stitcher.clone()))
        .ok_or("no active scroll session")?;
    cancel.store(true, std::sync::atomic::Ordering::SeqCst);

    let s = stitcher_arc.lock().await;
    Ok(crate::scroll_stitch::StitchedImage {
        rgba: s.canvas_bytes_clone(),
        width: s.width(),
        height: s.height(),
    })
}

#[tauri::command]
pub async fn scroll_copy(app: AppHandle, mgr: State<'_, Arc<WindowMgr>>) -> Result<(), String> {
    let monitor_id = mgr.scroll_ref(|s| s.monitor_id);
    let img = materialize_scroll_image(&mgr).await?;
    let _ = mgr.take_scroll();
    if let Some(mid) = monitor_id {
        close_scroll_chrome(&app, mid);
    }
    clipboard::copy_image(img.rgba, img.width, img.height).map_err(|e| e.to_string())?;
    mgr.end_session_deactivating_app(&app);
    Ok(())
}

#[tauri::command]
pub async fn scroll_save(
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let monitor_id = mgr.scroll_ref(|s| s.monitor_id);
    let mut settings = settings_store::load().unwrap_or_default();
    let path = match saver::choose_save_path(&settings).map_err(|e| e.to_string())? {
        Some(path) => path,
        None => return Ok(None),
    };

    let img = materialize_scroll_image(&mgr).await?;
    let _ = mgr.take_scroll();
    if let Some(mid) = monitor_id {
        close_scroll_chrome(&app, mid);
    }
    mgr.end_session(&app);
    schedule_app_deactivation_macos(&app);
    saver::save_image_to_path(img.rgba, img.width, img.height, &path).map_err(|e| e.to_string())?;
    saver::remember_last_save_dir(&mut settings, &path);
    settings_store::save(&settings).map_err(|e| e.to_string())?;
    let _ = app.emit("settings:changed", ());
    Ok(Some(path.to_string_lossy().to_string()))
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

        let crop_idx = body.find("crop_rgba").unwrap();
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
    fn capture_completion_paths_deactivate_app_after_hiding_overlays() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        for name in [
            "crop_and_copy",
            "cancel_capture",
            "pin_image",
            "scroll_pin",
            "scroll_copy",
        ] {
            let body = function_body(&source, name);
            assert!(
                body.contains("mgr.end_session_deactivating_app(&app);"),
                "{name} must end capture and deactivate the app so existing utility windows do not surface",
            );
        }

        let stop_body = function_body(&source, "stop_scroll_session");
        assert!(
            stop_body.contains("mgr.end_session_deactivating_app(&app);"),
            "canceling a scroll session must also deactivate after hiding overlays",
        );
    }

    #[test]
    fn save_paths_deactivate_app_after_user_facing_dialogs() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let crop_body = function_body(&source, "crop_and_save");
        let crop_end_idx = crop_body.find("mgr.end_session(&app);").unwrap();
        let dialog_idx = crop_body.find("saver::save_image_dialog").unwrap();
        let crop_deactivate_idx = crop_body
            .find("schedule_app_deactivation_macos(&app);")
            .expect("crop_and_save must deactivate after the save dialog returns");
        assert!(
            crop_end_idx < dialog_idx && dialog_idx < crop_deactivate_idx,
            "crop_and_save must hide overlays, show the save dialog, then deactivate the app",
        );

        let scroll_body = function_body(&source, "scroll_save");
        let scroll_end_idx = scroll_body.find("mgr.end_session(&app);").unwrap();
        let scroll_deactivate_idx = scroll_body
            .find("schedule_app_deactivation_macos(&app);")
            .expect("scroll_save must deactivate after hiding overlays");
        let save_idx = scroll_body.find("saver::save_image_to_path").unwrap();
        assert!(
            scroll_end_idx < scroll_deactivate_idx && scroll_deactivate_idx < save_idx,
            "scroll_save must deactivate immediately after hiding overlays because its path dialog already returned",
        );
    }

    #[test]
    fn crop_commands_apply_corner_radius_after_compositing() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        for name in ["crop_and_copy", "crop_and_save"] {
            let body = function_body(&source, name);
            let composite_idx = body.find("composite_annotation").unwrap();
            let mask_idx = body
                .find("apply_rounded_corners")
                .unwrap_or_else(|| panic!("{name} must call mask::apply_rounded_corners"));
            assert!(
                composite_idx < mask_idx,
                "{name}: mask must be applied after compositing annotations",
            );
            assert!(
                body.contains("corner_radius"),
                "{name} must accept a corner_radius parameter",
            );
        }

        let pin_body = function_body(&source, "pin_image");
        assert!(
            pin_body.contains("corner_radius"),
            "pin_image must accept a corner_radius parameter",
        );
        assert!(
            pin_body.contains("apply_rounded_corners"),
            "pin_image must call mask::apply_rounded_corners",
        );
        assert!(
            !pin_body.contains("composite_annotation"),
            "pin_image should keep annotation PNGs as a separate layer",
        );
    }

    #[test]
    fn output_commands_apply_image_adjustments_to_base_before_overlays() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        for name in ["crop_and_copy", "crop_and_save"] {
            let body = function_body(&source, name);
            let adjust_idx = body
                .find("image_adjust::apply_image_adjustments")
                .unwrap_or_else(|| panic!("{name} must apply image adjustments"));
            let composite_idx = body.find("composite_annotation").unwrap();
            assert!(
                adjust_idx < composite_idx,
                "{name}: image adjustments must affect only the cropped base before annotation compositing",
            );
        }

        let pin_body = function_body(&source, "pin_image");
        let adjust_idx = pin_body
            .find("image_adjust::apply_image_adjustments")
            .expect("pin_image must apply image adjustments");
        let mask_idx = pin_body
            .find("apply_rounded_corners")
            .expect("pin_image must still apply rounded corners");
        assert!(
            adjust_idx < mask_idx,
            "pin_image: image adjustments must be applied before the pin base image is masked",
        );
        assert!(
            !pin_body.contains("composite_annotation"),
            "pin_image should keep annotation PNGs as a separate layer",
        );
    }

    #[test]
    fn quick_shot_paths_do_not_apply_corner_radius() {
        let source = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .unwrap()
        .replace("\r\n", "\n");
        for name in [
            "copy_active_display_to_clipboard",
            "copy_active_window_to_clipboard",
        ] {
            let body = function_body(&source, name);
            assert!(
                !body.contains("apply_rounded_corners"),
                "{name}: fullscreen and active-window quick-shots must stay rectangular",
            );
        }
    }

    #[test]
    fn clamp_corner_radius_caps_backend_command_inputs() {
        assert_eq!(clamp_corner_radius(0), 0);
        assert_eq!(clamp_corner_radius(60), 60);
        assert_eq!(clamp_corner_radius(61), 60);
        assert_eq!(clamp_corner_radius(u32::MAX), 60);
    }

    #[test]
    fn start_scroll_session_cleans_up_if_initial_capture_fails() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn start_scroll_session").unwrap();
        let end = source[start..]
            .find("fn spawn_scroll_chrome")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        let capture_idx = body.find("capture_monitor_region").unwrap();
        let cleanup_idx = body.find("close_scroll_chrome(&app, monitor_id)").unwrap();

        assert!(
            capture_idx < cleanup_idx,
            "initial capture failure must restore chrome/mouse state before returning Err",
        );
    }

    #[test]
    fn start_scroll_session_emits_initial_progress_before_capture_loop() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "start_scroll_session");
        let stitcher_idx = body.find("ScrollStitcher::new").unwrap();
        let initial_progress_idx = body.find("emit_initial_progress").unwrap();
        let loop_idx = body.find("spawn_loop").unwrap();

        assert!(
            stitcher_idx < initial_progress_idx && initial_progress_idx < loop_idx,
            "scroll mode must send the initial selected preview before the capture loop emits append progress",
        );
    }

    #[test]
    fn scroll_chrome_position_prefers_right_lower_side() {
        let pos = scroll_chrome_position(
            Rect {
                x: 100,
                y: 120,
                width: 300,
                height: 240,
            },
            Rect {
                x: 0,
                y: 0,
                width: 1200,
                height: 800,
            },
            (320.0, 180.0),
            12.0,
        );

        assert_eq!(pos.x, 412.0);
        assert_eq!(pos.y, 180.0);
    }

    #[test]
    fn scroll_chrome_position_flips_left_when_right_overflows() {
        let pos = scroll_chrome_position(
            Rect {
                x: 840,
                y: 120,
                width: 300,
                height: 240,
            },
            Rect {
                x: 0,
                y: 0,
                width: 1200,
                height: 800,
            },
            (320.0, 180.0),
            12.0,
        );

        assert_eq!(pos.x, 508.0);
        assert_eq!(pos.y, 180.0);
    }

    #[test]
    fn scroll_chrome_position_clamps_inside_monitor_when_neither_side_fits() {
        let pos = scroll_chrome_position(
            Rect {
                x: 40,
                y: 720,
                width: 1140,
                height: 60,
            },
            Rect {
                x: 0,
                y: 0,
                width: 1200,
                height: 800,
            },
            (320.0, 180.0),
            12.0,
        );

        assert_eq!(pos.x, 868.0);
        assert_eq!(pos.y, 600.0);
    }

    #[test]
    fn scroll_chrome_size_preserves_selection_aspect_ratio_at_compact_width() {
        let (width, height) = scroll_chrome_size(
            Rect {
                x: 100,
                y: 120,
                width: 300,
                height: 240,
            },
            Rect {
                x: 0,
                y: 0,
                width: 1200,
                height: 800,
            },
            12.0,
        );

        assert_eq!(width, 280.0);
        assert_eq!(height, 224.0);
    }

    #[test]
    fn scroll_chrome_size_clamps_tiny_and_tall_selection_heights() {
        let monitor = Rect {
            x: 0,
            y: 0,
            width: 1200,
            height: 800,
        };

        let (_, tiny_height) = scroll_chrome_size(
            Rect {
                x: 100,
                y: 120,
                width: 300,
                height: 80,
            },
            monitor,
            12.0,
        );
        let (_, tall_height) = scroll_chrome_size(
            Rect {
                x: 100,
                y: 120,
                width: 300,
                height: 1200,
            },
            monitor,
            12.0,
        );

        assert_eq!(tiny_height, 160.0);
        assert_eq!(tall_height, 776.0);
    }

    #[test]
    fn spawn_scroll_chrome_uses_right_lower_position_helper() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "spawn_scroll_chrome");

        assert!(body.contains("scroll_chrome_position("));
        assert!(!body.contains("sel_logical_bottom + gap + chrome_h"));
    }

    #[test]
    fn spawn_scroll_chrome_sizes_panel_from_selection() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "spawn_scroll_chrome");

        assert!(
            body.contains("scroll_chrome_size(logical_selection, mon.rect, gap)"),
            "scroll preview chrome should derive its aspect-fitted height from the selected region",
        );
        assert!(
            !body.contains("let chrome_w = 320.0_f64")
                && !body.contains("let chrome_h = 220.0_f64"),
            "scroll preview chrome should not use the old fixed 320x220 size",
        );
    }

    #[test]
    fn spawn_scroll_chrome_accepts_first_mouse_for_finish_button() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "spawn_scroll_chrome");

        assert!(
            body.contains(".accept_first_mouse(true)"),
            "first click on the inactive preview chrome should reach the Check button",
        );
    }

    #[test]
    fn start_scroll_session_keeps_finish_control_in_preview_chrome() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "start_scroll_session");

        assert!(
            !body.contains("spawn_scroll_finish"),
            "finish UI must live in the preview chrome, not in a separate window inside the captured rect",
        );
    }

    #[test]
    fn close_scroll_chrome_only_closes_preview_chrome() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "close_scroll_chrome");

        assert!(
            !body.contains("overlay-scroll-finish-"),
            "there should be no independent finish window that can survive scroll teardown",
        );
    }

    #[test]
    fn macos_deactivation_is_scheduled_on_main_thread() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn start_scroll_session").unwrap();
        let end = source[start..]
            .find("fn spawn_scroll_chrome")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            !body.contains("deactivate_app_macos();"),
            "start_scroll_session runs on a Tauri IPC worker and must not call AppKit directly",
        );

        let helper_source = include_str!("app_activation.rs").replace("\r\n", "\n");
        let helper_start = helper_source
            .find("pub fn schedule_app_deactivation_macos")
            .expect("missing macOS main-thread scheduling helper");
        let helper_end = helper_source[helper_start..]
            .find("fn deactivate_app_macos_on_main_thread")
            .map(|idx| helper_start + idx)
            .expect("missing main-thread AppKit helper");
        let helper_body = &helper_source[helper_start..helper_end];

        assert!(
            helper_body.contains(".run_on_main_thread("),
            "macOS app deactivation must be dispatched to the main thread",
        );
    }

    #[test]
    fn scroll_result_serializes_frame_count_for_frontend() {
        let value = serde_json::to_value(ScrollResult {
            width: 300,
            height: 1200,
            frame_count: 4,
        })
        .unwrap();

        assert_eq!(value["frameCount"], 4);
        assert!(
            value.get("frame_count").is_none(),
            "frontend expects camelCase ScrollResult fields",
        );
    }

    #[test]
    fn stop_scroll_session_returns_summary_without_materializing_canvas() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn stop_scroll_session").unwrap();
        let end = source[start..]
            .find("async fn materialize_scroll_image")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            !body.contains("canvas_bytes_clone"),
            "Done should only return dimensions; cloning the full long image blocks the UI",
        );
        assert!(
            !body.contains("StitchedImage"),
            "Done should not materialize the full stitched image before showing Copy/Save",
        );
    }

    #[test]
    fn scroll_copy_and_save_materialize_canvas_lazily() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let helper_start = source
            .find("async fn materialize_scroll_image")
            .expect("missing lazy materialization helper");
        let helper_end = source[helper_start..]
            .find("#[tauri::command]\npub async fn scroll_copy")
            .map(|idx| helper_start + idx)
            .unwrap();
        let helper_body = &source[helper_start..helper_end];

        assert!(
            helper_body.contains("canvas_bytes_clone"),
            "Copy/Save path must still materialize the stitched canvas before output",
        );

        let copy_start = source.find("pub async fn scroll_copy").unwrap();
        let save_start = source.find("pub async fn scroll_save").unwrap();
        let copy_body = &source[copy_start..save_start];
        let save_body = &source[save_start..];

        assert!(copy_body.contains("materialize_scroll_image(&mgr).await"));
        assert!(save_body.contains("materialize_scroll_image(&mgr).await"));
    }

    #[test]
    fn scroll_save_prompts_for_path_before_materializing_canvas() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let start = source.find("pub async fn scroll_save").unwrap();
        let end = source[start..]
            .find("#[cfg(test)]")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        let prompt_idx = body.find("saver::choose_save_path").unwrap();
        let materialize_idx = body.find("materialize_scroll_image(&mgr).await").unwrap();
        let write_idx = body.find("saver::save_image_to_path").unwrap();

        assert!(
            prompt_idx < materialize_idx,
            "Save should show the native dialog before generating the full long image",
        );
        assert!(
            materialize_idx < write_idx,
            "the full image must still be materialized before writing the selected path",
        );
    }

    #[test]
    fn pin_annotation_update_merges_stored_and_unsaved_annotation_layers() {
        let tmp = tempfile::tempdir().unwrap();
        let stored_annotation_path = tmp.path().join("pin-annotation.png");
        let stored_annotation = vec![255, 0, 0, 255, 0, 0, 0, 0];
        let new_annotation = vec![0, 0, 0, 0, 0, 255, 0, 255];
        std::fs::write(
            &stored_annotation_path,
            encode_pin_png(&stored_annotation, 2, 1).unwrap(),
        )
        .unwrap();
        let new_annotation_png = encode_pin_png(&new_annotation, 2, 1).unwrap();

        let merged =
            merge_pin_annotation_layers(Some(&stored_annotation_path), &new_annotation_png)
                .expect("annotation layers should merge");
        let decoded = image::load_from_memory(&merged).unwrap().to_rgba8();

        assert_eq!(decoded.dimensions(), (2, 1));
        let rgba = decoded.into_raw();
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&rgba[4..8], &[0, 255, 0, 255]);
    }

    #[test]
    fn pin_annotation_update_keeps_higher_resolution_edited_layer() {
        let tmp = tempfile::tempdir().unwrap();
        let stored_annotation_path = tmp.path().join("pin-annotation.png");
        let stored_annotation = vec![255, 0, 0, 255, 0, 0, 0, 0];
        let new_annotation = vec![
            0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0,
            0, 0, 0, 0, 255, 0, 255,
        ];
        std::fs::write(
            &stored_annotation_path,
            encode_pin_png(&stored_annotation, 2, 1).unwrap(),
        )
        .unwrap();
        let new_annotation_png = encode_pin_png(&new_annotation, 4, 2).unwrap();

        let merged =
            merge_pin_annotation_layers(Some(&stored_annotation_path), &new_annotation_png)
                .expect("annotation layers should merge");
        let decoded = image::load_from_memory(&merged).unwrap().to_rgba8();

        assert_eq!(decoded.dimensions(), (4, 2));
    }

    #[test]
    fn pin_copy_composes_stored_and_unsaved_annotation_layers() {
        let tmp = tempfile::tempdir().unwrap();
        let base_path = tmp.path().join("pin.png");
        let stored_annotation_path = tmp.path().join("pin-annotation.png");
        let base = vec![255, 255, 255, 255, 255, 255, 255, 255];
        let stored_annotation = vec![255, 0, 0, 255, 0, 0, 0, 0];
        let new_annotation = vec![0, 0, 0, 0, 0, 255, 0, 255];
        std::fs::write(&base_path, encode_pin_png(&base, 2, 1).unwrap()).unwrap();
        std::fs::write(
            &stored_annotation_path,
            encode_pin_png(&stored_annotation, 2, 1).unwrap(),
        )
        .unwrap();
        let new_annotation_png = encode_pin_png(&new_annotation, 2, 1).unwrap();

        let composed = compose_pin_image(
            &base_path,
            Some(&stored_annotation_path),
            Some(&new_annotation_png),
            ImageAdjustments::default(),
        )
        .unwrap();

        assert_eq!(composed.width, 2);
        assert_eq!(composed.height, 1);
        assert_eq!(&composed.rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&composed.rgba[4..8], &[0, 255, 0, 255]);
    }

    #[test]
    fn pin_copy_applies_image_adjustments_to_base_before_annotation_layers() {
        let tmp = tempfile::tempdir().unwrap();
        let base_path = tmp.path().join("pin.png");
        let base = vec![100, 100, 100, 255];
        std::fs::write(&base_path, encode_pin_png(&base, 1, 1).unwrap()).unwrap();

        let composed = compose_pin_image(
            &base_path,
            None,
            None,
            ImageAdjustments {
                brightness: 20,
                ..ImageAdjustments::default()
            },
        )
        .unwrap();

        assert_eq!(composed.rgba, vec![151, 151, 151, 255]);
    }

    #[test]
    fn pin_edit_commands_accept_annotation_png_and_are_registered() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let update_body = function_body(&source, "update_pin_annotation");
        let save_body = function_body(&source, "save_pin");
        let copy_body = function_body(&source, "copy_pin");

        assert!(
            source.contains(
                "pub async fn update_pin_annotation(\n    pin_id: String,\n    annotation_png: Option<Vec<u8>>,"
            ),
            "update_pin_annotation must accept optional exported annotation data",
        );
        assert!(
            source.contains(
                "pub async fn copy_pin(\n    pin_id: String,\n    annotation_png: Option<Vec<u8>>,\n    adjustments: Option<ImageAdjustments>,"
            ),
            "copy_pin must accept optional unsaved annotation data and image adjustments",
        );
        assert!(
            source.contains(
                "pub async fn save_pin(\n    pin_id: String,\n    annotation_png: Option<Vec<u8>>,\n    adjustments: Option<ImageAdjustments>,"
            ),
            "save_pin must accept optional unsaved annotation data and image adjustments",
        );
        assert!(
            update_body.contains("update_annotation"),
            "update_pin_annotation must persist the new annotation path in PinManager",
        );
        assert!(
            save_body.contains("saver::save_image_dialog"),
            "save_pin must save the composed pin image through the regular save dialog",
        );
        assert!(
            copy_body.contains("clipboard::copy_image"),
            "copy_pin must copy the composed pin image to the clipboard",
        );

        let lib_source = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        )
        .unwrap();
        assert!(lib_source.contains("commands::update_pin_annotation"));
        assert!(lib_source.contains("commands::save_pin"));
        assert!(lib_source.contains("commands::copy_pin"));
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
    fn pin_image_appends_radius_to_route_when_nonzero() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "create_pin_from_image");
        assert!(
            body.contains("&radius="),
            "pin_image must forward corner_radius to the pin route URL when > 0",
        );
        assert!(
            body.contains("if corner_radius > 0"),
            "pin_image must only append the radius query param when nonzero",
        );
    }

    #[test]
    fn pin_window_starts_hidden_without_native_shadow() {
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
            body.contains(".visible(false)"),
            "pin windows should not paint the native first frame before the route is ready",
        );
        assert!(
            body.contains("show_pin_window(&window)"),
            "the backend must show hidden pin windows instead of relying on frontend JS",
        );
    }

    #[test]
    fn pin_window_reserves_right_and_bottom_gutters_without_left_control_gutter() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let pin_body = function_body(&source, "create_pin_from_image");
        let scale_body = function_body(&source, "set_pin_scale");

        assert!(
            pin_body.contains(
                "display_rect.width as f64 + 2.0 * PIN_SHADOW_PADDING + PIN_CONTROLS_SIDE_RESERVE",
            ),
            "pin window width should reserve controls only on the right side",
        );
        assert!(
            pin_body.contains(
                "display_rect.height as f64 + 2.0 * PIN_SHADOW_PADDING + PIN_TOOLBAR_BOTTOM_RESERVE",
            ),
            "pin window height should reserve the annotation toolbar gutter at the bottom",
        );
        assert!(
            pin_body.contains(
                "let pin_x = monitor_origin.0 + display_rect.x as f64 - PIN_SHADOW_PADDING;",
            ),
            "pin image should start after only the left shadow padding",
        );
        assert!(
            !pin_body.contains("2.0 * PIN_CONTROLS_SIDE_RESERVE"),
            "pin window should not reserve a left-side control gutter",
        );
        assert!(
            scale_body.contains("+ PIN_CONTROLS_SIDE_RESERVE")
                && scale_body.contains("+ PIN_TOOLBAR_BOTTOM_RESERVE"),
            "pin scaling should preserve right and bottom tool gutters",
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

    #[test]
    fn utility_window_background_tracks_effective_theme() {
        assert_eq!(
            utility_window_background_color(TauriTheme::Dark),
            UTILITY_WINDOW_DARK_BACKGROUND
        );
        assert_eq!(
            utility_window_background_color(TauriTheme::Light),
            UTILITY_WINDOW_LIGHT_BACKGROUND
        );
    }

    #[test]
    fn utility_windows_start_hidden_with_theme_bootstrap() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        for name in [
            "open_settings_window",
            "open_about_window",
            "open_updater_window",
        ] {
            let body = function_body(&source, name);
            assert!(
                body.contains(".visible(false)"),
                "{name} must stay hidden until its background is configured",
            );
            assert!(
                body.contains(".theme(theme)"),
                "{name} must apply the saved window theme before showing",
            );
            assert!(
                body.contains(".background_color(utility_window_initial_background(theme))"),
                "{name} must configure the native/webview first-frame background",
            );
            assert!(
                body.contains(".initialization_script(utility_window_init_script(theme))"),
                "{name} must bootstrap the document theme before React mounts",
            );
        }
    }

    #[test]
    fn reopened_menu_windows_are_explicitly_brought_to_front() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        for name in [
            "open_settings_window",
            "open_about_window",
            "open_updater_window",
        ] {
            let body = function_body(&source, name);
            assert!(
                body.contains("show_utility_window(&w, theme)?;"),
                "{name} must raise an already-open window instead of only focusing it",
            );
        }
    }

    #[test]
    fn macos_menu_window_fronting_activates_before_keying_window() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "bring_macos_app_window_to_front");

        let order_idx = body.find("orderFrontRegardless").unwrap();
        let activate_idx = body.find("activateIgnoringOtherApps:").unwrap();
        let key_idx = body.find("makeKeyAndOrderFront:").unwrap();

        assert!(
            order_idx < activate_idx && activate_idx < key_idx,
            "macOS menu windows must be ordered front, then app-activated, then made key",
        );
    }

    #[test]
    fn macos_menu_window_fronting_runs_directly_on_main_thread() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");
        let body = function_body(&source, "bring_app_window_to_front");

        let main_thread_idx = body.find("macos_is_main_thread()").unwrap();
        let direct_front_idx = body
            .find("bring_macos_app_window_to_front(window)")
            .unwrap();
        let dispatch_idx = body.find("run_on_main_thread").unwrap();

        assert!(
            main_thread_idx < direct_front_idx && direct_front_idx < dispatch_idx,
            "menu event callbacks already run on the main thread and must not synchronously requeue",
        );
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

    #[test]
    fn updater_commands_select_stable_or_beta_endpoint_from_beta_flag() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");

        assert!(
            source.contains("const STABLE_UPDATE_ENDPOINT"),
            "updater commands must keep the stable endpoint explicit",
        );
        assert!(
            source.contains("const BETA_UPDATE_ENDPOINT"),
            "updater commands must keep the beta endpoint explicit",
        );
        assert!(
            source.contains("https://raw.githubusercontent.com/poneding/flashot/beta/latest.json"),
            "beta-enabled users must read the beta channel manifest",
        );
        assert!(
            source.contains("fn update_endpoints(allow_beta: bool)"),
            "update endpoint selection must be controlled by the saved beta setting",
        );
        assert!(
            source.contains(".updater_builder()")
                && source.contains(".endpoints(update_endpoints(allow_beta)?"),
            "custom commands must build the updater with the selected channel endpoints",
        );
    }

    #[test]
    fn beta_update_checks_fall_back_to_stable_when_beta_manifest_is_missing() {
        let endpoints = update_endpoints(true).unwrap();

        assert_eq!(endpoints.len(), 2);
        assert_eq!(endpoints[0].as_str(), BETA_UPDATE_ENDPOINT);
        assert_eq!(endpoints[1].as_str(), STABLE_UPDATE_ENDPOINT);
        assert_eq!(
            update_endpoints(false).unwrap()[0].as_str(),
            STABLE_UPDATE_ENDPOINT
        );
    }

    #[test]
    fn updater_download_command_emits_progress_events() {
        let source = include_str!("commands.rs").replace("\r\n", "\n");

        assert!(source.contains("const UPDATER_PROGRESS_EVENT: &str = \"updater:progress\""));
        assert!(source.contains("pub async fn download_and_install_update"));
        assert!(source.contains("download_and_install("));
        assert!(source.contains("app.emit(UPDATER_PROGRESS_EVENT"));
    }

    fn function_body<'a>(source: &'a str, name: &str) -> &'a str {
        let needle = format!("fn {name}");
        let start = source
            .find(&needle)
            .unwrap_or_else(|| panic!("{name} not found"));
        let body_start = source[start..].find('{').map(|idx| start + idx).unwrap();
        let mut depth = 0usize;
        for (idx, ch) in source[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return &source[body_start..body_start + idx + 1];
                    }
                }
                _ => {}
            }
        }
        panic!("{name} body did not close");
    }
}
