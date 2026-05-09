use anyhow::Result;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter,
};
use tauri_plugin_shell::ShellExt;

const REPO_URL: &str = "https://github.com/poneding/flashot";

pub fn install(app: &AppHandle) -> Result<()> {
    let capture = MenuItem::with_id(app, "capture", "Capture", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Flashot", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&capture, &sep, &settings, &updates, &about, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let _ = app.emit("capture:trigger", ());
            }
            "settings" => {
                let _ = crate::commands::open_settings_window(app.clone());
            }
            "updates" => {
                #[allow(deprecated)]
                let _ = app.shell().open(format!("{REPO_URL}/releases"), None);
            }
            "about" => {
                #[allow(deprecated)]
                let _ = app.shell().open(REPO_URL, None);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|_tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                // Future: surface settings on double-click; no-op for V0
            }
        })
        .build(app)?;

    Ok(())
}
