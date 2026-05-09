pub mod types;
pub mod capture;
pub mod window_probe;
pub mod clipboard;
pub mod saver;
pub mod settings_store;
pub mod hotkey;
pub mod window_mgr;
pub mod commands;
pub mod tray;

use anyhow::{Context, Result};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener, Manager};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use window_mgr::WindowMgr;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing with daily log rotation
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {
            // Single instance enforced; no-op on duplicate launch
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // Create shared WindowMgr state
            let mgr = WindowMgr::new();
            app.manage(mgr.clone());

            // Install tray icon
            tray::install(app.handle())?;

            // Spawn overlay windows (one per monitor, hidden initially)
            spawn_overlays(app.handle())?;

            // Set up hotkey service
            let hotkey_svc = hotkey::HotkeyService::new()
                .context("Failed to create hotkey service")?;

            // Load settings and register hotkey
            let settings = settings_store::load().unwrap_or_default();
            hotkey_svc.set(&settings.hotkey)
                .context("Failed to register hotkey")?;

            let receiver = hotkey_svc.receiver();
            let app_handle = app.handle().clone();

            // Spawn hotkey event loop
            std::thread::spawn(move || {
                loop {
                    if let Ok(event) = receiver.recv() {
                        if event.id == hotkey::current_id() {
                            let _ = app_handle.emit("capture:trigger", ());
                        }
                    }
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::crop_and_copy,
            commands::crop_and_save,
            commands::cancel_capture,
            commands::get_settings,
            commands::set_settings,
            commands::open_settings_window,
            commands::quit_app,
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
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    // Leak the guard to keep logging alive for the app lifetime
    std::mem::forget(_guard);
}

fn spawn_overlays(app: &AppHandle) -> Result<()> {
    let monitors = capture::capture_all_monitors()
        .context("Failed to enumerate monitors for overlay creation")?
        .0;

    for mon in monitors {
        let label = format!("overlay-{}", mon.id);
        let url = tauri::WebviewUrl::App("index.html#/overlay".into());

        tauri::WebviewWindowBuilder::new(app, &label, url)
            .title("Flashot Overlay")
            .position(mon.rect.x as f64, mon.rect.y as f64)
            .inner_size(mon.rect.width as f64, mon.rect.height as f64)
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible(false)
            .transparent(true)
            .build()
            .context("Failed to create overlay window")?;
    }

    Ok(())
}

async fn run_capture(app: AppHandle, mgr: Arc<WindowMgr>) -> Result<()> {
    // Prevent double-trigger
    if mgr.in_session() {
        tracing::warn!("Capture already in session, ignoring trigger");
        return Ok(());
    }

    // Begin session
    let guard = mgr.begin(app.clone());

    // Capture all monitors and enumerate windows in parallel
    let (capture_result, windows_result) = tokio::join!(
        tokio::task::spawn_blocking(|| capture::capture_all_monitors()),
        tokio::task::spawn_blocking(|| window_probe::enumerate()),
    );

    let (monitors, frames) = capture_result
        .context("Capture task panicked")?
        .context("Failed to capture monitors")?;
    let windows = windows_result
        .context("Window enumeration task panicked")?
        .context("Failed to enumerate windows")?;

    // Get app cache directory for storing frames
    let cache_dir = app.path().app_cache_dir()
        .context("Failed to get cache directory")?;
    std::fs::create_dir_all(&cache_dir)
        .context("Failed to create cache directory")?;

    // Process each monitor
    for (mon, frame) in monitors.iter().zip(frames.iter()) {
        // Save frame as PNG
        let frame_path = cache_dir.join(format!("frame_{}.png", mon.id));
        save_frame_as_png(&frame, &frame_path)
            .context("Failed to save frame as PNG")?;

        // Convert to asset:// URL
        let asset_url = format!("asset://localhost/{}", frame_path.to_string_lossy());

        // Show overlay window
        let label = format!("overlay-{}", mon.id);
        if let Some(window) = app.get_webview_window(&label) {
            window.show().context("Failed to show overlay window")?;
            window.set_ignore_cursor_events(false)
                .context("Failed to enable cursor events")?;

            // Filter windows overlapping this monitor
            let local_windows: Vec<_> = windows.iter()
                .filter(|w| rects_overlap(&w.rect, &mon.rect))
                .map(|w| types::WindowRect {
                    rect: translate_to_monitor(&w.rect, &mon.rect),
                    title: w.title.clone(),
                    app_name: w.app_name.clone(),
                    pid: w.pid,
                })
                .collect();

            // Emit capture:start event with payload
            #[derive(serde::Serialize, Clone)]
            struct CaptureStartPayload {
                monitor_id: u32,
                frame_url: String,
                windows: Vec<types::WindowRect>,
            }

            window.emit("capture:start", CaptureStartPayload {
                monitor_id: mon.id,
                frame_url: asset_url,
                windows: local_windows,
            }).context("Failed to emit capture:start event")?;
        }

        // Store frame in WindowMgr
        mgr.store_frame(frame.clone());
    }

    // Leak the guard - it will be cleaned up when commands complete
    std::mem::forget(guard);

    Ok(())
}

fn save_frame_as_png(frame: &types::FrozenFrame, path: &std::path::Path) -> Result<()> {
    use image::{ImageBuffer, RgbaImage};

    let img: RgbaImage = ImageBuffer::from_raw(frame.width, frame.height, frame.rgba.clone())
        .context("Failed to create image buffer from RGBA data")?;

    img.save(path)
        .context("Failed to save PNG file")?;

    Ok(())
}

fn rects_overlap(a: &types::Rect, b: &types::Rect) -> bool {
    let a_right = a.x + a.width as i32;
    let a_bottom = a.y + a.height as i32;
    let b_right = b.x + b.width as i32;
    let b_bottom = b.y + b.height as i32;

    !(a_right <= b.x || b_right <= a.x || a_bottom <= b.y || b_bottom <= a.y)
}

fn translate_to_monitor(window_rect: &types::Rect, monitor_rect: &types::Rect) -> types::Rect {
    types::Rect {
        x: window_rect.x - monitor_rect.x,
        y: window_rect.y - monitor_rect.y,
        width: window_rect.width,
        height: window_rect.height,
    }
}
