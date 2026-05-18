use anyhow::Result;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter,
};

const TRAY_ID: &str = "main";

pub fn install(app: &AppHandle, capture_hotkey: &str) -> Result<()> {
    let menu = build_menu(app, capture_hotkey)?;
    let tray_icon = tray_icon_image()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .icon_as_template(tray_icon_is_template())
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
                let _ = app.emit("updater:check", ());
            }
            "about" => {
                let _ = crate::commands::open_about_window(app.clone());
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

#[cfg(target_os = "macos")]
fn tray_icon_image() -> Result<tauri::image::Image<'static>> {
    Ok(tauri::image::Image::from_bytes(include_bytes!(
        "../icons/menubar-logo.png"
    ))?)
}

#[cfg(not(target_os = "macos"))]
fn tray_icon_image() -> Result<tauri::image::Image<'static>> {
    Ok(tauri::image::Image::from_bytes(include_bytes!(
        "../icons/menubar-colored-logo.png"
    ))?)
}

fn tray_icon_is_template() -> bool {
    cfg!(target_os = "macos")
}

pub fn update_menu(app: &AppHandle, capture_hotkey: &str) -> Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(build_menu(app, capture_hotkey)?))?;

    Ok(())
}

fn build_menu(app: &AppHandle, capture_hotkey: &str) -> Result<Menu<tauri::Wry>> {
    let capture = MenuItem::with_id(
        app,
        "capture",
        "Capture",
        true,
        capture_menu_accelerator(capture_hotkey),
    )?;
    let settings = MenuItem::with_id(
        app,
        "settings",
        "Settings…",
        true,
        Some("CommandOrControl+,"),
    )?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "About", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        "Quit Flashot",
        true,
        Some("CommandOrControl+Q"),
    )?;

    let menu = Menu::with_items(
        app,
        &[&capture, &sep, &settings, &updates, &about, &sep, &quit],
    )?;
    Ok(menu)
}

fn capture_menu_accelerator(capture_hotkey: &str) -> Option<&str> {
    Some(capture_hotkey)
}

#[cfg(test)]
mod tests {
    #[test]
    fn capture_menu_uses_configured_hotkey_as_accelerator() {
        assert_eq!(super::capture_menu_accelerator("F1"), Some("F1"));
        assert_eq!(
            super::capture_menu_accelerator("Cmd+Shift+X"),
            Some("Cmd+Shift+X")
        );
    }
}
