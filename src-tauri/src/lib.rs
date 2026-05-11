pub mod capture;
pub mod clipboard;
pub mod commands;
pub mod hotkey;
pub mod overlay_window;
pub mod permission;
pub mod saver;
pub mod settings_store;
pub mod tray;
pub mod types;
pub mod window_mgr;
pub mod window_probe;

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

            if !permission::probe_screen_recording() {
                tracing::warn!("screen recording permission not granted");
                // Tray menu will show a red dot (V0.1 polish)
            }

            // Spawn overlay windows (one per monitor, hidden initially)
            spawn_overlays(app.handle())?;

            // Set up hotkey service
            let hotkey_svc =
                Arc::new(hotkey::HotkeyService::new().context("Failed to create hotkey service")?);

            // Load settings and register hotkey
            let settings = settings_store::load().unwrap_or_default();
            hotkey_svc
                .set(&settings.hotkey)
                .context("Failed to register hotkey")?;

            let receiver = hotkey_svc.receiver();
            let app_handle = app.handle().clone();

            // Spawn hotkey event loop
            std::thread::spawn(move || loop {
                if let Ok(event) = receiver.recv() {
                    if event.id == hotkey::current_id() {
                        let _ = app_handle.emit("capture:trigger", ());
                    }
                }
            });

            // Re-register hotkey when settings change. We push the HotkeyService
            // into a Mutex-wrapped state slot for live updates.
            use std::sync::Mutex as StdMutex;
            let hk_arc = StdMutex::new(hotkey_svc.clone());
            app.manage(hk_arc);

            let app_for_settings = app.handle().clone();
            app.listen("settings:changed", move |_| {
                let app = app_for_settings.clone();
                let s = settings_store::load().unwrap_or_default();
                let hk_state = app.state::<StdMutex<Arc<hotkey::HotkeyService>>>();
                let svc = hk_state.lock().unwrap().clone();
                if let Err(e) = svc.set(&s.hotkey) {
                    tracing::warn!("hotkey re-register failed: {e}");
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
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    // Leak the guard to keep logging alive for the app lifetime
    std::mem::forget(_guard);
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
            overlay_window::configure_capture_overlay(&window)
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
            .visible_on_all_workspaces(true)
            .shadow(false)
            .visible(false)
            .transparent(true)
            .accept_first_mouse(overlay_window::capture_overlay_accepts_first_mouse())
            .build()
            .context("Failed to create overlay window")?;
        window
            .set_ignore_cursor_events(true)
            .context("Failed to initialize overlay cursor passthrough")?;
        overlay_window::configure_capture_overlay(&window)
            .context("Failed to configure overlay window")?;
    }

    Ok(())
}

fn overlay_label(monitor_id: u32) -> String {
    format!("overlay-{monitor_id}")
}

fn capture_start_target(label: &str) -> tauri::EventTarget {
    tauri::EventTarget::webview_window(label)
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
    windows: Vec<types::WindowRect>,
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

    let windows = windows_result
        .context("Window enumeration task panicked")?
        .context("Failed to enumerate windows")?;
    tracing::info!("run_capture: enumerated {} windows", windows.len());

    // Get app cache directory for storing frames
    tracing::info!("run_capture: getting cache directory");
    let cache_dir = app
        .path()
        .app_cache_dir()
        .context("Failed to get cache directory")?;
    std::fs::create_dir_all(&cache_dir).context("Failed to create cache directory")?;
    tracing::info!("run_capture: cache dir: {:?}", cache_dir);

    // Process each monitor
    tracing::info!("run_capture: processing {} monitors", monitors.len());
    for (mon, frame) in monitors.iter().zip(frames.iter()) {
        tracing::info!("run_capture: processing monitor {}", mon.id);
        tracing::info!("run_capture: storing frame for monitor {}", mon.id);
        mgr.store_frame(frame.clone());

        // Save frame as PNG
        let frame_path = cache_dir.join(format!("frame_{}.png", mon.id));
        tracing::info!("run_capture: saving frame to {:?}", frame_path);
        save_frame_as_png(frame, &frame_path).context("Failed to save frame as PNG")?;
        tracing::info!("run_capture: frame saved successfully");

        // Convert to asset:// URL
        let asset_url = format!("asset://localhost/{}", frame_path.to_string_lossy());
        tracing::info!("run_capture: asset URL: {}", asset_url);

        // Show overlay window
        let label = overlay_label(mon.id);
        tracing::info!("run_capture: showing overlay window: {}", label);
        if let Some(window) = app.get_webview_window(&label) {
            window.show().context("Failed to show overlay window")?;
            window
                .set_ignore_cursor_events(false)
                .context("Failed to enable cursor events")?;
            overlay_window::bring_capture_overlay_to_front(&window)
                .context("Failed to bring overlay window to front")?;
            if let Err(e) = window.set_focus() {
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

            tracing::info!("run_capture: emitting capture:start event");
            app.emit_to(
                capture_start_target(&label),
                "capture:start",
                CaptureStartPayload {
                    monitor_id: mon.id,
                    frame_url: asset_url,
                    monitor_rect: mon.rect,
                    scale_factor: mon.scale_factor,
                    windows: local_windows,
                },
            )
            .context("Failed to emit capture:start event")?;
            tracing::info!("run_capture: capture:start event emitted");
        } else {
            tracing::warn!("run_capture: overlay window {} not found", label);
        }
    }

    // Leak the guard - it will be cleaned up when commands complete
    tracing::info!("run_capture: leaking guard, capture setup complete");
    std::mem::forget(guard);

    Ok(())
}

fn save_frame_as_png(frame: &types::FrozenFrame, path: &std::path::Path) -> Result<()> {
    let png = encode_frame_as_png(frame).context("Failed to encode PNG file")?;
    std::fs::write(path, png).context("Failed to save PNG file")?;

    Ok(())
}

fn encode_frame_as_png(frame: &types::FrozenFrame) -> Result<Vec<u8>> {
    use image::{
        codecs::png::{CompressionType, FilterType, PngEncoder},
        ExtendedColorType, ImageEncoder,
    };

    let mut png = Vec::new();
    let encoder = PngEncoder::new_with_quality(
        &mut png,
        CompressionType::Uncompressed,
        FilterType::NoFilter,
    );
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
    fn fast_png_encoder_writes_a_decodable_overlay_frame() {
        let frame = types::FrozenFrame {
            monitor_id: 42,
            rgba: vec![255, 0, 0, 255, 0, 255, 0, 255],
            width: 2,
            height: 1,
            scale_factor: 1.0,
        };

        let png = encode_frame_as_png(&frame).expect("png should encode");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));

        let decoded = image::load_from_memory(&png)
            .expect("png should decode")
            .to_rgba8();
        assert_eq!(decoded.dimensions(), (2, 1));
        assert_eq!(decoded.into_raw(), frame.rgba);
    }
}
