pub mod app_activation;
pub mod capture;
pub mod clipboard;
pub mod commands;
pub mod hotkey;
pub mod i18n;
pub mod image_adjust;
pub mod mask;
pub mod overlay_window;
pub mod permission;
pub mod pin_mgr;
pub mod saver;
pub mod scroll_session;
pub mod scroll_stitch;
pub mod settings_store;
pub mod tray;
pub mod tray_template_icon;
pub mod types;
pub mod window_mgr;
pub mod window_probe;

use anyhow::{Context, Result};
use pin_mgr::PinManager;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::ThreadId;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Listener, Manager, WindowEvent};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use window_mgr::WindowMgr;

static FRAME_REVISION_COUNTER: AtomicU64 = AtomicU64::new(0);
static HOTKEY_THREAD_ID: OnceLock<ThreadId> = OnceLock::new();
const AUTO_UPDATE_POLL_INTERVAL: Duration = Duration::from_secs(60);
const MIN_UPDATE_CHECK_INTERVAL_HOURS: u32 = 1;
const MAX_UPDATE_CHECK_INTERVAL_HOURS: u32 = 168;
const HOTKEY_UPDATE_TIMEOUT: Duration = Duration::from_millis(500);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing with daily log rotation
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Single instance enforced; no-op on duplicate launch
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let label = window.label();
                if let Some(pin_id) = label.strip_prefix("pin-")
                    && let Some(pin_mgr) = window.app_handle().try_state::<Arc<PinManager>>()
                    && let Some(entry) = pin_mgr.remove_pin(pin_id)
                {
                    if let Err(e) = std::fs::remove_file(&entry.image_path) {
                        tracing::warn!("failed to remove pin PNG {:?}: {e}", entry.image_path);
                    }
                    if let Some(annotation_path) = entry.annotation_path
                        && let Err(e) = std::fs::remove_file(&annotation_path)
                    {
                        tracing::warn!(
                            "failed to remove pin annotation PNG {:?}: {e}",
                            annotation_path
                        );
                    }
                }
                return;
            }

            if !matches!(event, WindowEvent::ThemeChanged(_)) {
                return;
            }

            let app = window.app_handle().clone();
            let settings = settings_store::load().unwrap_or_default();
            if settings.theme == settings_store::Theme::System {
                commands::refresh_open_utility_windows_appearance(&app, &settings);
            }
            if let Err(e) = tray::update_menu(
                &app,
                &settings.capture_hotkey,
                &settings.fullscreen_hotkey,
                &settings.active_window_hotkey,
                settings.language,
            ) {
                tracing::warn!("tray menu theme update failed: {e}");
            }
        })
        .setup(|app| {
            configure_capture_app_shell(app.handle())?;

            // Create shared WindowMgr state
            let mgr = WindowMgr::new();
            app.manage(mgr.clone());

            // Create shared PinManager state for pinned screenshot windows
            app.manage(PinManager::new());

            // Clean up any stale pin PNGs from previous sessions (PinManager always
            // starts empty, so any leftover files are orphaned).
            if let Ok(cache_dir) = app.path().app_cache_dir()
                && let Err(e) = remove_stale_pin_files(&cache_dir)
            {
                tracing::warn!("failed to clean stale pin files: {e}");
            }

            let settings = settings_store::load().unwrap_or_default();

            if !permission::probe_screen_recording() {
                tracing::warn!("screen recording permission not granted");
                // Tray menu will show a red dot (V0.1 polish)
            }

            // Spawn overlay windows (one per monitor, hidden initially)
            spawn_overlays(app.handle())?;

            install_tray(
                app.handle(),
                &settings.capture_hotkey,
                &settings.fullscreen_hotkey,
                &settings.active_window_hotkey,
                settings.language,
            );

            // Set up hotkey service
            let _ = HOTKEY_THREAD_ID.set(std::thread::current().id());
            hotkey::initialize().context("Failed to create hotkey service")?;

            // Register configured hotkeys
            register_startup_hotkeys(&settings, hotkey::set_all);
            spawn_auto_update_check_loop(app.handle());

            let receiver = hotkey::receiver();
            let app_handle = app.handle().clone();
            let mgr_for_hotkey = mgr.clone();

            // Spawn hotkey event loop
            std::thread::spawn(move || {
                loop {
                    if let Ok(event) = receiver.recv() {
                        if event.state() != global_hotkey::HotKeyState::Pressed {
                            continue;
                        }
                        match hotkey::action_for_event(
                            event.id,
                            hotkey::current_ids(),
                            mgr_for_hotkey.in_session(),
                        ) {
                            Some(hotkey::HotkeyAction::TriggerCapture) => {
                                let _ = app_handle.emit("capture:trigger", ());
                            }
                            Some(hotkey::HotkeyAction::CopyActiveDisplay) => {
                                spawn_quick_shot(
                                    app_handle.clone(),
                                    mgr_for_hotkey.clone(),
                                    QuickShotKind::ActiveDisplay,
                                );
                            }
                            Some(hotkey::HotkeyAction::CopyActiveWindow) => {
                                spawn_quick_shot(
                                    app_handle.clone(),
                                    mgr_for_hotkey.clone(),
                                    QuickShotKind::ActiveWindow,
                                );
                            }
                            Some(hotkey::HotkeyAction::CancelCapture) => {
                                mgr_for_hotkey.end_session_deactivating_app(&app_handle);
                            }
                            Some(hotkey::HotkeyAction::ColorFormatToggle) => {
                                let _ =
                                    app_handle.emit("capture:color-format-toggle-requested", ());
                            }
                            Some(hotkey::HotkeyAction::ColorCopy) => {
                                let _ = app_handle.emit("capture:color-copy-requested", ());
                            }
                            None => {}
                        }
                    }
                }
            });

            let app_for_settings = app.handle().clone();
            app.listen("settings:changed", move |_| {
                let app = app_for_settings.clone();
                let s = settings_store::load().unwrap_or_default();
                let next_capture_hotkey = s.capture_hotkey.clone();
                let next_fullscreen_hotkey = s.fullscreen_hotkey.clone();
                let next_active_window_hotkey = s.active_window_hotkey.clone();
                if let Err(e) = app.run_on_main_thread(move || {
                    if let Err(e) = hotkey::set_all(
                        &next_capture_hotkey,
                        &next_fullscreen_hotkey,
                        &next_active_window_hotkey,
                    ) {
                        tracing::warn!("hotkey re-register failed: {e}");
                    }
                }) {
                    tracing::warn!("hotkey re-register dispatch failed: {e}");
                }
                if let Err(e) = tray::update_menu(
                    &app,
                    &s.capture_hotkey,
                    &s.fullscreen_hotkey,
                    &s.active_window_hotkey,
                    s.language,
                ) {
                    tracing::warn!("tray menu update failed: {e}");
                }
            });

            // Register capture trigger handler
            let app_handle = app.handle().clone();
            let mgr_clone = mgr.clone();
            app.listen("capture:trigger", move |_event| {
                let app = app_handle.clone();
                let mgr = mgr_clone.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = run_capture(app, mgr).await {
                        tracing::error!("Capture failed: {e:?}");
                    }
                });
            });

            let app_for_quick_display = app.handle().clone();
            let mgr_for_quick_display = mgr.clone();
            app.listen("quick-shot:active-display", move |_| {
                spawn_quick_shot(
                    app_for_quick_display.clone(),
                    mgr_for_quick_display.clone(),
                    QuickShotKind::ActiveDisplay,
                );
            });

            let app_for_quick_window = app.handle().clone();
            let mgr_for_quick_window = mgr.clone();
            app.listen("quick-shot:active-window", move |_| {
                spawn_quick_shot(
                    app_for_quick_window.clone(),
                    mgr_for_quick_window.clone(),
                    QuickShotKind::ActiveWindow,
                );
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::crop_and_copy,
            commands::crop_and_save,
            commands::cancel_capture,
            commands::get_settings,
            commands::set_settings,
            commands::choose_default_save_dir,
            commands::check_for_update,
            commands::download_and_install_update,
            commands::open_settings_window,
            commands::begin_text_input_session,
            commands::end_text_input_session,
            commands::open_about_window,
            commands::open_updater_window,
            commands::push_capture_cursor_macos,
            commands::quit_app,
            commands::list_system_fonts,
            commands::pin_image,
            commands::close_pin,
            commands::set_pin_scale,
            commands::update_pin_annotation,
            commands::save_pin,
            commands::copy_pin,
            commands::start_scroll_session,
            commands::stop_scroll_session,
            commands::scroll_pin,
            commands::scroll_copy,
            commands::scroll_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn init_tracing() {
    let log_dir = dirs::cache_dir()
        .map(|d| d.join("flashot").join("logs"))
        .unwrap_or_else(|| std::env::temp_dir().join("flashot-logs"));

    std::fs::create_dir_all(&log_dir).ok();

    let file_appender = tracing_appender::rolling::daily(log_dir, "flashot.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    // Leak the guard to keep logging alive for the app lifetime
    std::mem::forget(_guard);
}

fn spawn_auto_update_check_loop(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            run_due_auto_update_check(app.clone()).await;
            tokio::time::sleep(AUTO_UPDATE_POLL_INTERVAL).await;
        }
    });
}

async fn run_due_auto_update_check(app: AppHandle) {
    let mut settings = match settings_store::load() {
        Ok(settings) => settings,
        Err(e) => {
            tracing::debug!("failed to load settings for auto update check: {e}");
            return;
        }
    };

    let now = current_unix_timestamp();
    if !auto_update_check_due(&settings, now) {
        return;
    }

    let allow_beta = settings.allow_beta_updates;
    settings.last_update_check_at = Some(now);
    if let Err(e) = settings_store::save(&settings) {
        tracing::warn!("failed to persist auto update check timestamp: {e}");
    }

    match commands::check_for_update(app.clone(), allow_beta).await {
        Ok(Some(_)) => {
            let app_for_window = app.clone();
            if let Err(e) = app.run_on_main_thread(move || {
                if let Err(e) = commands::open_updater_window(app_for_window) {
                    tracing::warn!("failed to open updater window after auto update check: {e}");
                }
            }) {
                tracing::warn!("failed to dispatch auto updater window: {e}");
            }
        }
        Ok(None) => {}
        Err(e) => tracing::debug!("auto update check failed: {e}"),
    }
}

fn auto_update_check_due(settings: &settings_store::Settings, now: i64) -> bool {
    if !settings.auto_check_updates {
        return false;
    }

    let Some(last_check) = settings.last_update_check_at else {
        return true;
    };

    let interval_seconds =
        normalized_update_check_interval_hours(settings.update_check_interval_hours) as i64
            * 60
            * 60;
    now.saturating_sub(last_check) >= interval_seconds
}

fn normalized_update_check_interval_hours(hours: u32) -> u32 {
    hours.clamp(
        MIN_UPDATE_CHECK_INTERVAL_HOURS,
        MAX_UPDATE_CHECK_INTERVAL_HOURS,
    )
}

fn current_unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn spawn_overlays(app: &AppHandle) -> Result<()> {
    let monitors = capture::enumerate_monitors()
        .context("Failed to enumerate monitors for overlay creation")?;

    ensure_overlays_for_monitors(app, &monitors)
}

fn ensure_overlays_for_monitors(app: &AppHandle, monitors: &[types::MonitorInfo]) -> Result<()> {
    for mon in monitors {
        let label = overlay_label(mon.id);
        if let Some(window) = app.get_webview_window(&label) {
            window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                    mon.rect.x as f64,
                    mon.rect.y as f64,
                )))
                .context("Failed to update overlay position")?;
            window
                .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    mon.rect.width as f64,
                    mon.rect.height as f64,
                )))
                .context("Failed to update overlay size")?;
            overlay_window::configure_capture_overlay(&window, mon.id, mon.rect)
                .context("Failed to configure overlay window")?;
            continue;
        }

        let url = tauri::WebviewUrl::App("index.html#/overlay".into());
        let window = tauri::WebviewWindowBuilder::new(app, &label, url)
            .title("Flashot Overlay")
            .position(mon.rect.x as f64, mon.rect.y as f64)
            .inner_size(mon.rect.width as f64, mon.rect.height as f64)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .focused(false)
            .visible_on_all_workspaces(true)
            .shadow(false)
            .visible(false)
            .transparent(true)
            .accept_first_mouse(overlay_window::capture_overlay_accepts_first_mouse())
            .build()
            .context("Failed to create overlay window")?;
        #[cfg(not(target_os = "linux"))]
        window
            .set_ignore_cursor_events(true)
            .context("Failed to initialize overlay cursor passthrough")?;
        overlay_window::configure_capture_overlay(&window, mon.id, mon.rect)
            .context("Failed to configure overlay window")?;
    }

    Ok(())
}

fn overlay_label(monitor_id: u32) -> String {
    format!("overlay-{monitor_id}")
}

#[cfg(target_os = "macos")]
fn capture_app_activation_policy() -> tauri::ActivationPolicy {
    tauri::ActivationPolicy::Accessory
}

#[cfg(target_os = "macos")]
fn configure_capture_app_shell(app: &AppHandle) -> Result<()> {
    app.set_activation_policy(capture_app_activation_policy())
        .context("Failed to set macOS activation policy for capture app")
}

#[cfg(not(target_os = "macos"))]
fn configure_capture_app_shell(_app: &AppHandle) -> Result<()> {
    Ok(())
}

fn capture_start_target(label: &str) -> tauri::EventTarget {
    tauri::EventTarget::webview_window(label)
}

fn run_hotkey_update(
    app: &AppHandle,
    action: &'static str,
    update: impl FnOnce() -> Result<()> + Send + 'static,
) {
    if HOTKEY_THREAD_ID
        .get()
        .is_some_and(|thread_id| *thread_id == std::thread::current().id())
    {
        if let Err(e) = update() {
            tracing::warn!("{action} failed: {e}");
        }
        return;
    }

    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    if let Err(e) = app.run_on_main_thread(move || {
        let _ = tx.send(update());
    }) {
        tracing::warn!("{action} dispatch failed: {e}");
        return;
    }

    match rx.recv_timeout(HOTKEY_UPDATE_TIMEOUT) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!("{action} failed: {e}"),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            tracing::warn!(
                "{action} did not complete within {:?}",
                HOTKEY_UPDATE_TIMEOUT
            );
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            tracing::warn!("{action} result channel disconnected");
        }
    }
}

fn set_capture_cancel_hotkey(app: &AppHandle, enabled: bool) {
    run_hotkey_update(app, "capture cancel hotkey update", move || {
        hotkey::set_capture_cancel_enabled(enabled)
    });
}

/// Session-scoped X/C hotkeys for the color picker. macOS-only: capture
/// overlays are shown without activating the app there, so webview keydown
/// handlers never fire and the keys would leak into the previous app. On
/// Windows/Linux the overlay owns keyboard focus and the webview path
/// already handles X/C; a global hotkey would double-fire the toggle.
fn set_color_picker_hotkeys(app: &AppHandle, enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        run_hotkey_update(app, "color picker hotkey update", move || {
            hotkey::set_color_picker_enabled(enabled)
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, enabled);
}

pub(crate) fn set_capture_session_hotkeys(app: &AppHandle, enabled: bool) {
    set_capture_cancel_hotkey(app, enabled);
    set_color_picker_hotkeys(app, enabled);
}

#[cfg(test)]
fn register_startup_hotkey<F>(accelerator: &str, register: F) -> bool
where
    F: FnOnce(&str) -> Result<u32>,
{
    match register(accelerator) {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("failed to register startup hotkey '{accelerator}': {e}");
            false
        }
    }
}

fn register_startup_hotkeys<F>(settings: &settings_store::Settings, register: F) -> bool
where
    F: FnOnce(&str, &str, &str) -> Result<hotkey::RegisteredHotkeyIds>,
{
    match register(
        &settings.capture_hotkey,
        &settings.fullscreen_hotkey,
        &settings.active_window_hotkey,
    ) {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!(
                "failed to register startup hotkeys '{}', '{}', '{}': {e}",
                settings.capture_hotkey,
                settings.fullscreen_hotkey,
                settings.active_window_hotkey
            );
            false
        }
    }
}

fn install_tray(
    app: &AppHandle,
    capture_hotkey: &str,
    fullscreen_hotkey: &str,
    active_window_hotkey: &str,
    language: settings_store::Language,
) {
    tray_template_icon::install();
    #[cfg(target_os = "linux")]
    {
        let app = app.clone();
        let capture_hotkey = capture_hotkey.to_string();
        let fullscreen_hotkey = fullscreen_hotkey.to_string();
        let active_window_hotkey = active_window_hotkey.to_string();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            tray::install(
                &app,
                &capture_hotkey,
                &fullscreen_hotkey,
                &active_window_hotkey,
                language,
            )
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!("tray icon not available: {e}"),
            Err(_) => tracing::warn!("tray icon not supported on this desktop environment"),
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        if let Err(e) = tray::install(
            app,
            capture_hotkey,
            fullscreen_hotkey,
            active_window_hotkey,
            language,
        ) {
            tracing::warn!("tray icon install failed: {e}");
        }
    }
}

#[derive(serde::Serialize, Clone)]
struct CaptureStartPayload {
    #[serde(rename = "monitorId")]
    monitor_id: u32,
    #[serde(rename = "frameUrl")]
    frame_url: String,
    #[serde(rename = "monitorRect")]
    monitor_rect: types::Rect,
    #[serde(rename = "scaleFactor")]
    scale_factor: f32,
    #[serde(rename = "cornerRadius")]
    corner_radius: u32,
    windows: Vec<types::WindowRect>,
}

#[derive(serde::Serialize, Clone)]
struct QuickShotFlashPayload {
    rect: types::Rect,
}

async fn run_capture(app: AppHandle, mgr: Arc<WindowMgr>) -> Result<()> {
    tracing::info!("run_capture: starting");

    // Prevent double-trigger
    if mgr.in_session() {
        tracing::warn!("Capture already in session, ignoring trigger");
        return Ok(());
    }

    // Begin session
    tracing::info!("run_capture: beginning session");
    let guard = mgr.begin(app.clone());
    set_capture_session_hotkeys(&app, true);

    // Record the app that was frontmost when the hotkey fired, BEFORE Flashot
    // activates itself for the overlay. Reactivating it on session end is what
    // restores utility-window (Settings/About/Updater) z-order to its original
    // background position. No-op handle off macOS.
    mgr.set_previous_app(app_activation::capture_previous_frontmost_app(&app));

    let current_monitors =
        capture::enumerate_monitors().context("Failed to enumerate monitors before capture")?;
    ensure_overlays_for_monitors(&app, &current_monitors)?;

    // Capture all monitors and enumerate windows in parallel
    tracing::info!("run_capture: spawning capture and window enumeration tasks");
    let (capture_result, windows_result) = tokio::join!(
        tokio::task::spawn_blocking(capture::capture_all_monitors),
        tokio::task::spawn_blocking(window_probe::enumerate),
    );

    tracing::info!("run_capture: tasks completed, processing results");
    let (monitors, frames) = capture_result
        .context("Capture task panicked")?
        .context("Failed to capture monitors")?;
    tracing::info!("run_capture: captured {} monitors", monitors.len());
    ensure_overlays_for_monitors(&app, &monitors)?;

    let windows = match windows_result {
        Ok(Ok(ws)) => {
            tracing::info!("run_capture: enumerated {} windows", ws.len());
            ws
        }
        Ok(Err(e)) => {
            tracing::warn!("Window enumeration failed, proceeding without window detection: {e}");
            Vec::new()
        }
        Err(e) => {
            tracing::warn!("Window enumeration task panicked: {e}");
            Vec::new()
        }
    };

    // Get app cache directory for storing frames
    tracing::info!("run_capture: getting cache directory");
    let cache_dir = app
        .path()
        .app_cache_dir()
        .context("Failed to get cache directory")?;
    std::fs::create_dir_all(&cache_dir).context("Failed to create cache directory")?;
    if let Err(e) = remove_stale_frame_files(&cache_dir) {
        tracing::warn!("run_capture: failed to clean stale frame files: {e}");
    }
    tracing::info!("run_capture: cache dir: {:?}", cache_dir);

    let frame_revision = next_frame_revision();

    // Process each monitor
    tracing::info!("run_capture: processing {} monitors", monitors.len());
    for (mon, frame) in monitors.iter().zip(frames.iter()) {
        tracing::info!("run_capture: processing monitor {}", mon.id);
        tracing::info!("run_capture: storing frame for monitor {}", mon.id);
        mgr.store_frame(frame.clone());

        // Save frame as PNG
        let frame_path = frame_asset_path(&cache_dir, mon.id, frame_revision);
        tracing::info!("run_capture: saving frame to {:?}", frame_path);
        save_frame_as_png(frame, &frame_path).context("Failed to save frame as PNG")?;
        tracing::info!("run_capture: frame saved successfully");

        // Convert to asset:// URL
        let asset_url = frame_asset_url(&cache_dir, mon.id, frame_revision);
        tracing::info!("run_capture: asset URL: {}", asset_url);

        // Show overlay window
        let label = overlay_label(mon.id);
        tracing::info!("run_capture: showing overlay window: {}", label);
        match app.get_webview_window(&label) {
            Some(window) => {
                window
                    .set_ignore_cursor_events(false)
                    .context("Failed to enable cursor events")?;
                overlay_window::show_capture_overlay(&window)
                    .context("Failed to show overlay window")?;
                if overlay_window::capture_overlay_should_take_focus()
                    && let Err(e) = window.set_focus()
                {
                    tracing::warn!("run_capture: failed to focus overlay window {label}: {e}");
                }
                tracing::info!("run_capture: overlay window shown");

                // Filter windows overlapping this monitor
                let local_windows: Vec<_> = windows
                    .iter()
                    .filter(|w| rects_overlap(&w.rect, &mon.rect))
                    .map(|w| types::WindowRect {
                        rect: translate_to_monitor(&w.rect, &mon.rect),
                        title: w.title.clone(),
                        app_name: w.app_name.clone(),
                        pid: w.pid,
                    })
                    .collect();
                tracing::info!(
                    "run_capture: {} windows overlap monitor {}",
                    local_windows.len(),
                    mon.id
                );

                let corner_radius = settings_store::load()
                    .map(|s| s.corner_radius.min(60))
                    .unwrap_or(0);
                tracing::info!("run_capture: emitting capture:start event");
                app.emit_to(
                    capture_start_target(&label),
                    "capture:start",
                    CaptureStartPayload {
                        monitor_id: mon.id,
                        frame_url: asset_url,
                        monitor_rect: mon.rect,
                        scale_factor: mon.scale_factor,
                        corner_radius,
                        windows: local_windows,
                    },
                )
                .context("Failed to emit capture:start event")?;
                tracing::info!("run_capture: capture:start event emitted");
            }
            _ => {
                tracing::warn!("run_capture: overlay window {} not found", label);
            }
        }
    }

    // Activate Flashot so the overlay cursor is honored: macOS only displays
    // the cursor owned by the frontmost app, so an overlay shown without
    // activation never got its crosshair to stick. Activating here (after every
    // overlay already covers its monitor) makes Flashot frontmost. Utility
    // windows (Settings/About/Updater) are pinned to the floating level by
    // design (see `commands.rs`), so activation does not visibly reshuffle
    // them — they stay where the user expects. The original frontmost app is
    // restored on session end. No-op off macOS.
    app_activation::activate_flashot_for_capture(&app);
    overlay_window::bring_all_capture_overlays_to_front(&app);

    // Final cursor push after the loop: (a) backstop for monitors whose
    // overlay window was not found above (that branch skips the per-show
    // push), and (b) a last word after the loop's intervening work (PNG
    // saves, event emits, window ordering) that can churn AppKit cursor
    // state. No-op off macOS.
    if let Err(e) = app.run_on_main_thread(overlay_window::push_capture_cursor) {
        tracing::warn!("run_capture: failed to schedule capture cursor push: {e}");
    }

    // Leak the guard - it will be cleaned up when commands complete
    tracing::info!("run_capture: leaking guard, capture setup complete");
    std::mem::forget(guard);

    Ok(())
}

#[derive(Clone, Copy)]
enum QuickShotKind {
    ActiveDisplay,
    ActiveWindow,
}

impl QuickShotKind {
    fn label(self) -> &'static str {
        match self {
            Self::ActiveDisplay => "active display",
            Self::ActiveWindow => "active window",
        }
    }
}

fn spawn_quick_shot(app: AppHandle, mgr: Arc<WindowMgr>, kind: QuickShotKind) {
    if mgr.in_session() {
        tracing::warn!(
            "{} quick shot ignored during active capture session",
            kind.label()
        );
        return;
    }

    tauri::async_runtime::spawn(async move {
        let result = match kind {
            QuickShotKind::ActiveDisplay => copy_active_display_to_clipboard(app, mgr).await,
            QuickShotKind::ActiveWindow => copy_active_window_to_clipboard(app, mgr).await,
        };

        if let Err(e) = result {
            tracing::error!("{} quick shot failed: {e:?}", kind.label());
        }
    });
}

async fn copy_active_display_to_clipboard(app: AppHandle, mgr: Arc<WindowMgr>) -> Result<()> {
    let active_window_rect = window_probe::active_window().map(|window| window.rect).ok();
    let (monitors, frames) = tokio::task::spawn_blocking(capture::capture_all_monitors)
        .await
        .context("Active display capture task panicked")?
        .context("Failed to capture monitors for active display quick shot")?;
    let cursor_display = current_cursor_display(&app, &monitors);
    let target = active_display_target(
        &monitors,
        &frames,
        cursor_display,
        active_window_rect.as_ref(),
    );
    let frame = target
        .as_ref()
        .map(|target| target.frame)
        .or_else(|| {
            active_display_frame(
                &monitors,
                &frames,
                cursor_display,
                active_window_rect.as_ref(),
            )
        })
        .context("No frame available for active display quick shot")?;

    clipboard::copy_image(frame.rgba.to_vec(), frame.width, frame.height)
        .context("Failed to copy active display quick shot to clipboard")?;
    if let Some(target) = target {
        show_quick_shot_flash(&app, target.monitor, target.rect, mgr)
            .context("Failed to show active display quick shot feedback")?;
    }
    Ok(())
}

async fn copy_active_window_to_clipboard(app: AppHandle, mgr: Arc<WindowMgr>) -> Result<()> {
    let active_window = window_probe::active_window().context("Failed to detect active window")?;
    let (monitors, frames) = tokio::task::spawn_blocking(capture::capture_all_monitors)
        .await
        .context("Active window capture task panicked")?
        .context("Failed to capture monitors for active window quick shot")?;
    let target = active_window_target(&monitors, &frames, &active_window.rect)
        .context("Active window does not overlap a captured monitor")?;
    let cropped = commands::crop_rgba(
        &target.frame.rgba,
        target.frame.width,
        target.frame.height,
        target.rect,
        target.frame.scale_factor,
    )
    .context("Failed to crop active window quick shot")?;

    clipboard::copy_image(cropped.rgba, cropped.width, cropped.height)
        .context("Failed to copy active window quick shot to clipboard")?;
    show_quick_shot_flash(&app, target.monitor, target.rect, mgr)
        .context("Failed to show active window quick shot feedback")?;
    Ok(())
}

fn show_quick_shot_flash(
    app: &AppHandle,
    monitor: &types::MonitorInfo,
    rect: types::Rect,
    mgr: Arc<WindowMgr>,
) -> Result<()> {
    ensure_overlays_for_monitors(app, std::slice::from_ref(monitor))
        .context("Failed to prepare quick shot flash overlay")?;

    let label = overlay_label(monitor.id);
    let Some(window) = app.get_webview_window(&label) else {
        tracing::warn!("quick shot flash overlay window {label} not found");
        return Ok(());
    };

    window
        .set_ignore_cursor_events(true)
        .context("Failed to enable quick shot flash cursor passthrough")?;
    overlay_window::show_capture_overlay(&window)
        .context("Failed to show quick shot flash overlay")?;
    app.emit_to(
        capture_start_target(&label),
        "quick-shot:flash",
        QuickShotFlashPayload { rect },
    )
    .context("Failed to emit quick shot flash event")?;

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(420)).await;
        if !mgr.in_session() {
            let _ = window.hide();
        }
    });

    Ok(())
}

fn next_frame_revision() -> u128 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = FRAME_REVISION_COUNTER.fetch_add(1, Ordering::Relaxed) as u128;

    now.saturating_add(counter)
}

fn frame_asset_path(
    cache_dir: &std::path::Path,
    monitor_id: u32,
    revision: u128,
) -> std::path::PathBuf {
    cache_dir.join(format!("frame_{monitor_id}_{revision}.png"))
}

fn frame_asset_url(cache_dir: &std::path::Path, monitor_id: u32, revision: u128) -> String {
    let path = frame_asset_path(cache_dir, monitor_id, revision);

    format!("asset://localhost/{}", path.to_string_lossy())
}

fn remove_stale_frame_files(cache_dir: &std::path::Path) -> Result<()> {
    for entry in std::fs::read_dir(cache_dir).context("Failed to read cache directory")? {
        let entry = entry.context("Failed to read cache directory entry")?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with("frame_") && file_name.ends_with(".png") {
            std::fs::remove_file(entry.path()).context("Failed to remove stale frame file")?;
        }
    }

    Ok(())
}

fn remove_stale_pin_files(cache_dir: &std::path::Path) -> Result<()> {
    let pins_dir = cache_dir.join("pins");
    if !pins_dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(&pins_dir).context("Failed to read pins cache directory")? {
        let entry = entry.context("Failed to read pins cache directory entry")?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.starts_with("pin-") && file_name.ends_with(".png") {
            std::fs::remove_file(entry.path()).context("Failed to remove stale pin file")?;
        }
    }

    Ok(())
}

fn save_frame_as_png(frame: &types::FrozenFrame, path: &std::path::Path) -> Result<()> {
    let png = encode_frame_as_png(frame).context("Failed to encode PNG file")?;
    std::fs::write(path, png).context("Failed to save PNG file")?;

    Ok(())
}

fn encode_frame_as_png(frame: &types::FrozenFrame) -> Result<Vec<u8>> {
    use image::{
        ExtendedColorType, ImageEncoder,
        codecs::png::{CompressionType, FilterType, PngEncoder},
    };

    let mut png = Vec::new();
    let mut encoder = PngEncoder::new_with_quality(
        &mut png,
        CompressionType::Uncompressed,
        FilterType::NoFilter,
    );
    if let Some(profile) = frame.icc_profile.as_ref() {
        encoder
            .set_icc_profile(profile.clone())
            .map_err(|err| anyhow::anyhow!("Failed to attach frame ICC profile: {err}"))?;
    }
    encoder
        .write_image(
            &frame.rgba,
            frame.width,
            frame.height,
            ExtendedColorType::Rgba8,
        )
        .context("Failed to encode frame as PNG")?;
    Ok(png)
}

fn rects_overlap(a: &types::Rect, b: &types::Rect) -> bool {
    let a_right = a.x + a.width as i32;
    let a_bottom = a.y + a.height as i32;
    let b_right = b.x + b.width as i32;
    let b_bottom = b.y + b.height as i32;

    !(a_right <= b.x || b_right <= a.x || a_bottom <= b.y || b_bottom <= a.y)
}

fn translate_to_monitor(window_rect: &types::Rect, monitor_rect: &types::Rect) -> types::Rect {
    let x1 = window_rect.x.max(monitor_rect.x);
    let y1 = window_rect.y.max(monitor_rect.y);
    let x2 =
        (window_rect.x + window_rect.width as i32).min(monitor_rect.x + monitor_rect.width as i32);
    let y2 = (window_rect.y + window_rect.height as i32)
        .min(monitor_rect.y + monitor_rect.height as i32);

    if x2 <= x1 || y2 <= y1 {
        return types::Rect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
    }

    types::Rect {
        x: x1 - monitor_rect.x,
        y: y1 - monitor_rect.y,
        width: (x2 - x1) as u32,
        height: (y2 - y1) as u32,
    }
}

fn monitor_with_largest_overlap<'a>(
    monitors: &'a [types::MonitorInfo],
    rect: &types::Rect,
) -> Option<&'a types::MonitorInfo> {
    monitors
        .iter()
        .max_by_key(|monitor| rect_intersection_area(rect, &monitor.rect))
        .filter(|monitor| rect_intersection_area(rect, &monitor.rect) > 0)
}

fn clip_to_monitor_local_rect(
    rect: &types::Rect,
    monitor: &types::MonitorInfo,
) -> Option<types::Rect> {
    let clipped = translate_to_monitor(rect, &monitor.rect);
    (clipped.width > 0 && clipped.height > 0).then_some(clipped)
}

#[derive(Debug, Clone, Copy)]
struct LogicalPoint {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy)]
struct PhysicalDisplay {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
}

fn current_cursor_display(
    app: &AppHandle,
    monitors: &[types::MonitorInfo],
) -> Option<PhysicalDisplay> {
    let point = current_cursor_capture_point(app)?;
    monitor_containing_point(monitors, point).map(physical_display_from_monitor)
}

fn current_cursor_capture_point(app: &AppHandle) -> Option<LogicalPoint> {
    let cursor = match app.cursor_position() {
        Ok(cursor) => cursor,
        Err(e) => {
            tracing::warn!("failed to read cursor position for quick shot: {e}");
            return None;
        }
    };

    let primary_scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);

    Some(LogicalPoint {
        x: cursor_axis_to_capture_axis(cursor.x, primary_scale),
        y: cursor_axis_to_capture_axis(cursor.y, primary_scale),
    })
}

#[cfg(target_os = "windows")]
fn cursor_axis_to_capture_axis(value: f64, _primary_scale: f64) -> i32 {
    value.round() as i32
}

#[cfg(not(target_os = "windows"))]
fn cursor_axis_to_capture_axis(value: f64, primary_scale: f64) -> i32 {
    let scale = if primary_scale > 0.0 {
        primary_scale
    } else {
        1.0
    };
    (value / scale).round() as i32
}

fn monitor_containing_point(
    monitors: &[types::MonitorInfo],
    point: LogicalPoint,
) -> Option<&types::MonitorInfo> {
    monitors
        .iter()
        .find(|monitor| monitor.rect.contains(point.x, point.y))
}

fn physical_display_from_monitor(monitor: &types::MonitorInfo) -> PhysicalDisplay {
    let scale = monitor.scale_factor.max(1.0);

    PhysicalDisplay {
        x: (monitor.rect.x as f32 * scale).round() as i32,
        y: (monitor.rect.y as f32 * scale).round() as i32,
        width: (monitor.rect.width as f32 * scale).round() as u32,
        height: (monitor.rect.height as f32 * scale).round() as u32,
        scale_factor: monitor.scale_factor,
    }
}

fn monitor_for_physical_display(
    monitors: &[types::MonitorInfo],
    display: PhysicalDisplay,
) -> Option<&types::MonitorInfo> {
    monitors
        .iter()
        .find(|monitor| monitor_matches_physical_display(monitor, display))
}

fn monitor_matches_physical_display(
    monitor: &types::MonitorInfo,
    display: PhysicalDisplay,
) -> bool {
    let logical_rect = logical_rect_for_physical_display(display);

    (monitor.scale_factor - display.scale_factor).abs() <= 0.05
        && rects_close(&monitor.rect, &logical_rect, 2)
}

fn logical_rect_for_physical_display(display: PhysicalDisplay) -> types::Rect {
    let scale = display.scale_factor.max(1.0);

    types::Rect {
        x: (display.x as f32 / scale).round() as i32,
        y: (display.y as f32 / scale).round() as i32,
        width: (display.width as f32 / scale).round() as u32,
        height: (display.height as f32 / scale).round() as u32,
    }
}

fn rects_close(a: &types::Rect, b: &types::Rect, tolerance: i32) -> bool {
    (a.x - b.x).abs() <= tolerance
        && (a.y - b.y).abs() <= tolerance
        && (a.width as i32 - b.width as i32).abs() <= tolerance
        && (a.height as i32 - b.height as i32).abs() <= tolerance
}

fn active_display_monitor<'a>(
    monitors: &'a [types::MonitorInfo],
    cursor_display: Option<PhysicalDisplay>,
    active_window_rect: Option<&types::Rect>,
) -> Option<&'a types::MonitorInfo> {
    cursor_display
        .and_then(|display| monitor_for_physical_display(monitors, display))
        .or_else(|| {
            active_window_rect.and_then(|rect| monitor_with_largest_overlap(monitors, rect))
        })
}

fn active_display_frame<'a>(
    monitors: &[types::MonitorInfo],
    frames: &'a [types::FrozenFrame],
    cursor_display: Option<PhysicalDisplay>,
    active_window_rect: Option<&types::Rect>,
) -> Option<&'a types::FrozenFrame> {
    active_display_monitor(monitors, cursor_display, active_window_rect)
        .and_then(|monitor| frames.iter().find(|frame| frame.monitor_id == monitor.id))
        .or_else(|| frames.first())
}

struct QuickShotTarget<'a> {
    monitor: &'a types::MonitorInfo,
    frame: &'a types::FrozenFrame,
    rect: types::Rect,
}

fn active_display_target<'a>(
    monitors: &'a [types::MonitorInfo],
    frames: &'a [types::FrozenFrame],
    cursor_display: Option<PhysicalDisplay>,
    active_window_rect: Option<&types::Rect>,
) -> Option<QuickShotTarget<'a>> {
    let monitor =
        active_display_monitor(monitors, cursor_display, active_window_rect).or_else(|| {
            frames.first().and_then(|frame| {
                monitors
                    .iter()
                    .find(|monitor| monitor.id == frame.monitor_id)
            })
        })?;
    let frame = frames.iter().find(|frame| frame.monitor_id == monitor.id)?;
    let rect = types::Rect {
        x: 0,
        y: 0,
        width: monitor.rect.width,
        height: monitor.rect.height,
    };

    Some(QuickShotTarget {
        monitor,
        frame,
        rect,
    })
}

fn active_window_target<'a>(
    monitors: &'a [types::MonitorInfo],
    frames: &'a [types::FrozenFrame],
    active_window_rect: &types::Rect,
) -> Option<QuickShotTarget<'a>> {
    let monitor = monitor_with_largest_overlap(monitors, active_window_rect)?;
    let frame = frames.iter().find(|frame| frame.monitor_id == monitor.id)?;
    let rect = clip_to_monitor_local_rect(active_window_rect, monitor)?;

    Some(QuickShotTarget {
        monitor,
        frame,
        rect,
    })
}

fn rect_intersection_area(a: &types::Rect, b: &types::Rect) -> u64 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.width as i32).min(b.x + b.width as i32);
    let y2 = (a.y + a.height as i32).min(b.y + b.height as i32);

    if x2 <= x1 || y2 <= y1 {
        return 0;
    }

    (x2 - x1) as u64 * (y2 - y1) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_to_monitor_clips_cross_monitor_windows_to_local_bounds() {
        let monitor = types::Rect {
            x: 100,
            y: 0,
            width: 300,
            height: 200,
        };
        let window = types::Rect {
            x: 50,
            y: 20,
            width: 200,
            height: 120,
        };

        let translated = translate_to_monitor(&window, &monitor);

        assert_eq!(
            (
                translated.x,
                translated.y,
                translated.width,
                translated.height
            ),
            (0, 20, 150, 120)
        );
    }

    #[test]
    fn quick_shot_monitor_selection_prefers_largest_window_overlap() {
        let monitors = vec![
            types::MonitorInfo {
                id: 1,
                rect: types::Rect {
                    x: 0,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
            types::MonitorInfo {
                id: 2,
                rect: types::Rect {
                    x: 400,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
        ];
        let foreground = types::Rect {
            x: 350,
            y: 20,
            width: 260,
            height: 120,
        };

        let selected =
            monitor_with_largest_overlap(&monitors, &foreground).expect("window overlaps monitors");

        assert_eq!(selected.id, 2);
    }

    #[test]
    fn quick_shot_clip_to_monitor_local_rect_limits_cross_screen_window() {
        let monitor = types::MonitorInfo {
            id: 2,
            rect: types::Rect {
                x: 400,
                y: 0,
                width: 400,
                height: 300,
            },
            scale_factor: 1.0,
        };
        let foreground = types::Rect {
            x: 350,
            y: 20,
            width: 260,
            height: 120,
        };

        let clipped = clip_to_monitor_local_rect(&foreground, &monitor)
            .expect("window should overlap monitor");

        assert_eq!(
            (clipped.x, clipped.y, clipped.width, clipped.height),
            (0, 20, 210, 120)
        );
    }

    #[test]
    fn quick_shot_active_display_frame_matches_selected_monitor_id() {
        let monitors = vec![
            types::MonitorInfo {
                id: 1,
                rect: types::Rect {
                    x: 0,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
            types::MonitorInfo {
                id: 2,
                rect: types::Rect {
                    x: 400,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
        ];
        let frames = vec![
            types::FrozenFrame {
                monitor_id: 2,
                rgba: vec![2, 2, 2, 255].into(),
                width: 1,
                height: 1,
                scale_factor: 1.0,
                icc_profile: None,
            },
            types::FrozenFrame {
                monitor_id: 1,
                rgba: vec![1, 1, 1, 255].into(),
                width: 1,
                height: 1,
                scale_factor: 1.0,
                icc_profile: None,
            },
        ];
        let foreground = types::Rect {
            x: 450,
            y: 20,
            width: 100,
            height: 100,
        };

        let frame = active_display_frame(&monitors, &frames, None, Some(&foreground))
            .expect("active display frame should be found by monitor id");

        assert_eq!(frame.monitor_id, 2);
        assert_eq!(frame.rgba.as_ref(), &[2, 2, 2, 255]);
    }

    #[test]
    fn quick_shot_active_display_frame_prefers_cursor_display_over_foreground_window() {
        let monitors = vec![
            types::MonitorInfo {
                id: 1,
                rect: types::Rect {
                    x: 0,
                    y: 0,
                    width: 720,
                    height: 450,
                },
                scale_factor: 2.0,
            },
            types::MonitorInfo {
                id: 2,
                rect: types::Rect {
                    x: 720,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                scale_factor: 1.0,
            },
        ];
        let frames = vec![
            types::FrozenFrame {
                monitor_id: 1,
                rgba: vec![1, 1, 1, 255].into(),
                width: 1440,
                height: 900,
                scale_factor: 2.0,
                icc_profile: None,
            },
            types::FrozenFrame {
                monitor_id: 2,
                rgba: vec![2, 2, 2, 255].into(),
                width: 1920,
                height: 1080,
                scale_factor: 1.0,
                icc_profile: None,
            },
        ];
        let cursor_display = PhysicalDisplay {
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
            scale_factor: 2.0,
        };
        let foreground_on_external = types::Rect {
            x: 900,
            y: 40,
            width: 600,
            height: 400,
        };

        let frame = active_display_frame(
            &monitors,
            &frames,
            Some(cursor_display),
            Some(&foreground_on_external),
        )
        .expect("cursor display should select the laptop frame");

        assert_eq!(frame.monitor_id, 1);
    }

    #[test]
    fn quick_shot_active_display_frame_falls_back_to_first_frame() {
        let frames = vec![types::FrozenFrame {
            monitor_id: 7,
            rgba: vec![7, 7, 7, 255].into(),
            width: 1,
            height: 1,
            scale_factor: 1.0,
            icc_profile: None,
        }];

        let frame = active_display_frame(&[], &frames, None, None)
            .expect("first frame is the fallback when active screen is unknown");

        assert_eq!(frame.monitor_id, 7);
    }

    #[test]
    fn quick_shot_active_window_target_uses_largest_overlap_and_local_rect() {
        let monitors = vec![
            types::MonitorInfo {
                id: 1,
                rect: types::Rect {
                    x: 0,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
            types::MonitorInfo {
                id: 2,
                rect: types::Rect {
                    x: 400,
                    y: 0,
                    width: 400,
                    height: 300,
                },
                scale_factor: 1.0,
            },
        ];
        let frames = vec![
            types::FrozenFrame {
                monitor_id: 2,
                rgba: vec![2, 2, 2, 255].into(),
                width: 1,
                height: 1,
                scale_factor: 1.0,
                icc_profile: None,
            },
            types::FrozenFrame {
                monitor_id: 1,
                rgba: vec![1, 1, 1, 255].into(),
                width: 1,
                height: 1,
                scale_factor: 1.0,
                icc_profile: None,
            },
        ];
        let foreground = types::Rect {
            x: 350,
            y: 20,
            width: 260,
            height: 120,
        };

        let target = active_window_target(&monitors, &frames, &foreground)
            .expect("active window should map to a captured frame");

        assert_eq!(target.frame.monitor_id, 2);
        assert_eq!(
            (
                target.rect.x,
                target.rect.y,
                target.rect.width,
                target.rect.height
            ),
            (0, 20, 210, 120)
        );
    }

    #[test]
    fn quick_shot_has_active_window_probe_entrypoint() {
        let _probe: fn() -> anyhow::Result<types::WindowRect> = window_probe::active_window;
    }

    #[test]
    fn overlay_label_uses_stable_monitor_id() {
        assert_eq!(overlay_label(42), "overlay-42");
    }

    #[test]
    fn capture_start_target_addresses_overlay_webview_window() {
        assert_eq!(
            capture_start_target("overlay-42"),
            tauri::EventTarget::webview_window("overlay-42")
        );
    }

    #[test]
    fn capture_start_does_not_show_temporary_focus_window() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let start = source.find("async fn run_capture").unwrap();
        let end = source[start..]
            .find("#[derive(Clone, Copy)]")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            !body.contains("prepare_capture_focus_window") && !body.contains("capture-focus"),
            "capture setup must not map a temporary Wayland focus window before the overlay"
        );
    }

    #[test]
    fn capture_overlay_show_path_does_not_use_focus_activating_show() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let body = function_body(&source, "run_capture");

        assert!(
            body.contains("overlay_window::show_capture_overlay(&window)"),
            "capture overlays must use the platform no-activation show path",
        );
        assert!(
            !body.contains("window.show().context(\"Failed to show overlay window\")"),
            "Tauri show can activate the app and bring utility windows forward on macOS",
        );
    }

    #[test]
    fn capture_setup_ends_with_capture_cursor_push() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let body = function_body(&source, "run_capture");

        assert!(
            body.contains("overlay_window::push_capture_cursor"),
            "run_capture must re-push the capture cursor after the overlay loop as the backstop for monitors whose per-show push was skipped",
        );
    }

    #[test]
    fn capture_reraises_overlays_after_macos_activation() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let body = function_body(&source, "run_capture");

        let activate_idx = body
            .find("app_activation::activate_flashot_for_capture(&app)")
            .expect("capture must activate Flashot for cursor ownership");
        let raise_idx = body
            .find("overlay_window::bring_all_capture_overlays_to_front(&app)")
            .expect("capture must re-raise overlays after activation");
        let cursor_idx = body
            .find("overlay_window::push_capture_cursor")
            .expect("capture must push the cursor after final overlay ordering");

        assert!(
            activate_idx < raise_idx && raise_idx < cursor_idx,
            "macOS activation can reorder native panels; overlays must be raised again before the final cursor push",
        );
    }

    #[test]
    fn capture_overlay_windows_start_unfocused() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let body = function_body(&source, "ensure_overlays_for_monitors");

        assert!(
            body.contains(".focused(false)"),
            "overlay windows should not request focus when created",
        );
    }

    #[test]
    fn cancel_hotkey_deactivates_app_after_ending_capture() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let start = source
            .find("Some(hotkey::HotkeyAction::CancelCapture)")
            .unwrap();
        let end = source[start..]
            .find("None => {}")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("mgr_for_hotkey.end_session_deactivating_app(&app_handle);"),
            "canceling from the global hotkey must not leave Flashot active with settings raised",
        );
    }

    #[test]
    fn global_hotkey_actions_only_fire_on_key_press() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let start = source.find("receiver.recv()").unwrap();
        let end = source[start..]
            .find("});\n\n            let app_for_settings")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("event.state() != global_hotkey::HotKeyState::Pressed"),
            "macOS fires Pressed and Released per keystroke; the hotkey loop must drop release events before routing actions",
        );
    }

    #[test]
    fn capture_start_payload_includes_corner_radius() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");
        let start = source.find("struct CaptureStartPayload").unwrap();
        let end = source[start..].find("}\n").map(|idx| start + idx).unwrap();
        let body = &source[start..end];
        assert!(
            body.contains("corner_radius"),
            "CaptureStartPayload must carry the persisted corner radius to the frontend",
        );
        assert!(
            body.contains("cornerRadius"),
            "CaptureStartPayload must serialize as camelCase cornerRadius",
        );
    }

    #[test]
    fn startup_hotkey_registration_failure_is_nonfatal() {
        let registered = register_startup_hotkey("F1", |accelerator| {
            assert_eq!(accelerator, "F1");
            Err(anyhow::anyhow!("reserved by system"))
        });

        assert!(!registered);
    }

    #[test]
    fn startup_hotkey_registration_uses_all_configured_shortcuts() {
        let settings = settings_store::Settings {
            capture_hotkey: "Cmd+Shift+A".to_string(),
            fullscreen_hotkey: "Cmd+Shift+F".to_string(),
            active_window_hotkey: "Cmd+Shift+W".to_string(),
            theme: settings_store::Theme::System,
            accent_color: "#4ED1FF".to_string(),
            language: settings_store::Language::En,
            launch_at_login: false,
            auto_check_updates: false,
            allow_beta_updates: false,
            update_check_interval_hours: 24,
            last_update_check_at: None,
            default_save_dir: settings_store::default_save_dir(),
            last_save_dir: None,
            corner_radius: 0,
        };

        let registered =
            register_startup_hotkeys(&settings, |capture, fullscreen, active_window| {
                assert_eq!(capture, "Cmd+Shift+A");
                assert_eq!(fullscreen, "Cmd+Shift+F");
                assert_eq!(active_window, "Cmd+Shift+W");
                Ok(hotkey::RegisteredHotkeyIds::default())
            });

        assert!(registered);
    }

    #[test]
    fn startup_auto_update_check_is_gated_by_settings() {
        let source = include_str!("lib.rs").replace("\r\n", "\n");

        assert!(source.contains("spawn_auto_update_check_loop(app.handle());"));
        assert!(source.contains("if !settings.auto_check_updates"));
        assert!(source.contains("auto_update_check_due(&settings, now)"));
        assert!(source.contains("settings.last_update_check_at = Some(now);"));
        assert!(source.contains("settings.allow_beta_updates"));
        assert!(source.contains("commands::check_for_update"));
        assert!(source.contains("commands::open_updater_window"));
    }

    #[test]
    fn auto_update_check_due_respects_saved_interval() {
        let mut settings = settings_store::Settings {
            auto_check_updates: true,
            update_check_interval_hours: 6,
            last_update_check_at: Some(1_000),
            ..settings_store::Settings::default()
        };

        assert!(!auto_update_check_due(&settings, 1_000 + 5 * 60 * 60));
        assert!(auto_update_check_due(&settings, 1_000 + 6 * 60 * 60));

        settings.last_update_check_at = None;
        assert!(auto_update_check_due(&settings, 1_000));

        settings.auto_check_updates = false;
        assert!(!auto_update_check_due(&settings, 1_000 + 24 * 60 * 60));
    }

    #[test]
    fn frame_asset_urls_change_between_capture_sessions() {
        let cache_dir = std::path::Path::new("/tmp/flashot-cache");

        let first = frame_asset_url(cache_dir, 42, 1);
        let second = frame_asset_url(cache_dir, 42, 2);

        assert_ne!(first, second);
        assert!(first.contains("frame_42_1.png"));
        assert!(second.contains("frame_42_2.png"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_capture_uses_accessory_activation_policy() {
        assert!(matches!(
            capture_app_activation_policy(),
            tauri::ActivationPolicy::Accessory
        ));
    }

    #[test]
    fn fast_png_encoder_writes_a_decodable_overlay_frame() {
        let frame = types::FrozenFrame {
            monitor_id: 42,
            rgba: vec![255, 0, 0, 255, 0, 255, 0, 255].into(),
            width: 2,
            height: 1,
            scale_factor: 1.0,
            icc_profile: None,
        };

        let png = encode_frame_as_png(&frame).expect("png should encode");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));

        let decoded = image::load_from_memory(&png)
            .expect("png should decode")
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.into_raw(), frame.rgba.as_ref());
    }

    #[test]
    fn overlay_frame_png_preserves_icc_profile() {
        use image::{ImageDecoder, codecs::png::PngDecoder};

        let profile = b"test-display-profile".to_vec();
        let frame = types::FrozenFrame {
            monitor_id: 42,
            rgba: vec![255, 0, 0, 255].into(),
            width: 1,
            height: 1,
            scale_factor: 1.0,
            icc_profile: Some(profile.clone()),
        };

        let png = encode_frame_as_png(&frame).expect("png should encode");
        let mut decoder = PngDecoder::new(std::io::Cursor::new(png)).expect("png should decode");

        assert_eq!(
            decoder.icc_profile().expect("icc profile should decode"),
            Some(profile)
        );
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
