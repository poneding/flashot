use anyhow::Result;
use tauri::{
    menu::{IconMenuItem, Menu, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Theme,
};
use tauri_plugin_shell::ShellExt;

const REPO_URL: &str = "https://github.com/poneding/flashot";
const TRAY_ID: &str = "main";
const MENU_ICON_IMAGE_SIZE: u32 = 36;

pub fn install(
    app: &AppHandle,
    capture_hotkey: &str,
    fullscreen_hotkey: &str,
    active_window_hotkey: &str,
) -> Result<()> {
    let menu = build_menu(app, capture_hotkey, fullscreen_hotkey, active_window_hotkey)?;
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
            "quick-active-screen" => {
                let _ = app.emit("quick-shot:active-display", ());
            }
            "quick-active-window" => {
                let _ = app.emit("quick-shot:active-window", ());
            }
            "settings" => {
                let _ = crate::commands::open_settings_window(app.clone());
            }
            "updates" => {
                #[allow(deprecated)]
                let _ = app.shell().open(format!("{REPO_URL}/releases"), None);
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

#[derive(Clone, Copy)]
enum MenuIcon {
    Crop,
    Monitor,
    AppWindow,
    Settings,
    Refresh,
    Info,
    CircleX,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MenuIconTheme {
    Light,
    Dark,
}

impl From<Theme> for MenuIconTheme {
    fn from(theme: Theme) -> Self {
        match theme {
            Theme::Dark => MenuIconTheme::Dark,
            Theme::Light => MenuIconTheme::Light,
            _ => MenuIconTheme::Light,
        }
    }
}

fn current_menu_icon_theme(app: &AppHandle) -> MenuIconTheme {
    app.webview_windows()
        .values()
        .find_map(|window| window.theme().ok())
        .map(MenuIconTheme::from)
        .unwrap_or(MenuIconTheme::Light)
}

fn lucide_menu_icon(icon: MenuIcon, theme: MenuIconTheme) -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(menu_icon_png(icon, theme))
        .expect("generated Lucide menu icon PNG should decode")
}

fn transparent_menu_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(
        vec![0; (MENU_ICON_IMAGE_SIZE * MENU_ICON_IMAGE_SIZE * 4) as usize],
        MENU_ICON_IMAGE_SIZE,
        MENU_ICON_IMAGE_SIZE,
    )
}

fn menu_item_icon(icon: Option<MenuIcon>, theme: MenuIconTheme) -> tauri::image::Image<'static> {
    icon.map(|icon| lucide_menu_icon(icon, theme))
        .unwrap_or_else(transparent_menu_icon)
}

fn menu_icon_png(icon: MenuIcon, theme: MenuIconTheme) -> &'static [u8] {
    match (icon, theme) {
        (MenuIcon::Crop, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/crop-light.png"))
        }
        (MenuIcon::Crop, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/crop-dark.png"))
        }
        (MenuIcon::Monitor, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/monitor-light.png"))
        }
        (MenuIcon::Monitor, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/monitor-dark.png"))
        }
        (MenuIcon::AppWindow, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/app-window-light.png"))
        }
        (MenuIcon::AppWindow, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/app-window-dark.png"))
        }
        (MenuIcon::Settings, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/settings-light.png"))
        }
        (MenuIcon::Settings, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/settings-dark.png"))
        }
        (MenuIcon::Refresh, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/refresh-cw-light.png"))
        }
        (MenuIcon::Refresh, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/refresh-cw-dark.png"))
        }
        (MenuIcon::Info, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/info-light.png"))
        }
        (MenuIcon::Info, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/info-dark.png"))
        }
        (MenuIcon::CircleX, MenuIconTheme::Light) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/circle-x-light.png"))
        }
        (MenuIcon::CircleX, MenuIconTheme::Dark) => {
            include_bytes!(concat!(env!("OUT_DIR"), "/menu-icons/circle-x-dark.png"))
        }
    }
}

pub fn update_menu(
    app: &AppHandle,
    capture_hotkey: &str,
    fullscreen_hotkey: &str,
    active_window_hotkey: &str,
) -> Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(build_menu(
        app,
        capture_hotkey,
        fullscreen_hotkey,
        active_window_hotkey,
    )?))?;

    Ok(())
}

fn build_menu(
    app: &AppHandle,
    capture_hotkey: &str,
    fullscreen_hotkey: &str,
    active_window_hotkey: &str,
) -> Result<Menu<tauri::Wry>> {
    let icon_theme = current_menu_icon_theme(app);
    let capture = IconMenuItem::with_id(
        app,
        "capture",
        "Capture Region",
        true,
        Some(menu_item_icon(Some(MenuIcon::Crop), icon_theme)),
        capture_menu_accelerator(capture_hotkey),
    )?;
    let active_screen = IconMenuItem::with_id(
        app,
        "quick-active-screen",
        "Capture Screen",
        true,
        Some(menu_item_icon(Some(MenuIcon::Monitor), icon_theme)),
        active_screen_menu_accelerator(fullscreen_hotkey),
    )?;
    let active_window = IconMenuItem::with_id(
        app,
        "quick-active-window",
        "Capture Window",
        true,
        Some(menu_item_icon(Some(MenuIcon::AppWindow), icon_theme)),
        active_window_menu_accelerator(active_window_hotkey),
    )?;
    let settings = IconMenuItem::with_id(
        app,
        "settings",
        "Settings…",
        true,
        Some(menu_item_icon(Some(MenuIcon::Settings), icon_theme)),
        settings_menu_accelerator(),
    )?;
    let updates = IconMenuItem::with_id(
        app,
        "updates",
        "Check for updates",
        true,
        Some(menu_item_icon(Some(MenuIcon::Refresh), icon_theme)),
        None::<&str>,
    )?;
    let about = IconMenuItem::with_id(
        app,
        "about",
        "About",
        true,
        Some(menu_item_icon(Some(MenuIcon::Info), icon_theme)),
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = IconMenuItem::with_id(
        app,
        "quit",
        "Quit Flashot",
        true,
        Some(menu_item_icon(Some(MenuIcon::CircleX), icon_theme)),
        quit_menu_accelerator(),
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &capture,
            &active_screen,
            &active_window,
            &sep,
            &settings,
            &updates,
            &about,
            &sep,
            &quit,
        ],
    )?;
    Ok(menu)
}

fn capture_menu_accelerator(capture_hotkey: &str) -> Option<&str> {
    Some(capture_hotkey)
}

fn active_screen_menu_accelerator(fullscreen_hotkey: &str) -> Option<&str> {
    Some(fullscreen_hotkey)
}

fn active_window_menu_accelerator(active_window_hotkey: &str) -> Option<&str> {
    Some(active_window_hotkey)
}

#[cfg(target_os = "macos")]
fn settings_menu_accelerator() -> Option<&'static str> {
    Some("Cmd+,")
}

#[cfg(not(target_os = "macos"))]
fn settings_menu_accelerator() -> Option<&'static str> {
    Some("Ctrl+,")
}

#[cfg(target_os = "macos")]
fn quit_menu_accelerator() -> Option<&'static str> {
    Some("Cmd+Q")
}

#[cfg(not(target_os = "macos"))]
fn quit_menu_accelerator() -> Option<&'static str> {
    Some("Ctrl+Q")
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

    #[test]
    fn capture_menu_icons_are_visible_images() {
        for icon in [
            super::MenuIcon::Crop,
            super::MenuIcon::Monitor,
            super::MenuIcon::AppWindow,
        ] {
            let image = super::lucide_menu_icon(icon, super::MenuIconTheme::Light);
            let visible_pixels = image
                .rgba()
                .chunks_exact(4)
                .filter(|pixel| pixel[3] > 0)
                .count();

            assert_eq!((image.width(), image.height()), (36, 36));
            assert!(visible_pixels > 40);
        }
    }

    #[test]
    fn capture_menu_icons_have_compact_visual_bounds() {
        for icon in [
            super::MenuIcon::Crop,
            super::MenuIcon::Monitor,
            super::MenuIcon::AppWindow,
        ] {
            let image = super::lucide_menu_icon(icon, super::MenuIconTheme::Light);
            let (width, height) = alpha_bounds(&image, 24)
                .map(|(min_x, min_y, max_x, max_y)| (max_x - min_x + 1, max_y - min_y + 1))
                .expect("icon should have visible pixels");

            assert!(
                width <= 30 && height <= 30,
                "expected compact icon bounds, got {width}x{height}"
            );
        }
    }

    #[test]
    fn capture_menu_icons_use_reduced_opacity_strokes() {
        for icon in [
            super::MenuIcon::Crop,
            super::MenuIcon::Monitor,
            super::MenuIcon::AppWindow,
        ] {
            let image = super::lucide_menu_icon(icon, super::MenuIconTheme::Light);
            let max_alpha = image
                .rgba()
                .chunks_exact(4)
                .map(|pixel| pixel[3])
                .max()
                .unwrap_or_default();

            assert!((180..=210).contains(&max_alpha));
        }
    }

    #[test]
    fn capture_menu_rect_icons_use_lucide_style_rounded_corners() {
        for (icon, top_y) in [
            (super::MenuIcon::Monitor, 3.0),
            (super::MenuIcon::AppWindow, 4.0),
        ] {
            let image = super::lucide_menu_icon(icon, super::MenuIconTheme::Light);
            let sample_y = scaled_icon_coordinate(top_y) - 0.5;
            let corner = alpha_at(&image, scaled_icon_coordinate(2.0), sample_y);
            let top_edge = alpha_at(&image, scaled_icon_coordinate(12.0), sample_y);

            assert!(
                corner < top_edge,
                "expected rounded corner alpha {corner} to be less than edge alpha {top_edge}"
            );
        }
    }

    #[test]
    fn menu_icons_use_light_pixels_for_dark_theme() {
        let light_image =
            super::lucide_menu_icon(super::MenuIcon::Monitor, super::MenuIconTheme::Light);
        let dark_image =
            super::lucide_menu_icon(super::MenuIcon::Monitor, super::MenuIconTheme::Dark);

        assert!(average_visible_luma(&dark_image) > average_visible_luma(&light_image));
    }

    #[test]
    fn menu_icon_pngs_are_generated_assets() {
        for icon in [
            super::MenuIcon::Crop,
            super::MenuIcon::Monitor,
            super::MenuIcon::AppWindow,
            super::MenuIcon::Settings,
            super::MenuIcon::Refresh,
            super::MenuIcon::Info,
            super::MenuIcon::CircleX,
        ] {
            for theme in [super::MenuIconTheme::Light, super::MenuIconTheme::Dark] {
                assert!(super::menu_icon_png(icon, theme).starts_with(b"\x89PNG\r\n\x1a\n"));
            }
        }
    }

    #[test]
    fn quit_menu_icon_uses_circle_x_shape() {
        let image = super::lucide_menu_icon(super::MenuIcon::CircleX, super::MenuIconTheme::Light);

        assert!(alpha_at_scaled(&image, 12.0, 2.0) > 100);
        assert!(alpha_at_scaled(&image, 10.0, 10.0) > 100);
        assert!(alpha_at_scaled(&image, 14.0, 10.0) > 100);
    }

    #[test]
    fn settings_menu_icon_uses_gear_shape() {
        let image = super::lucide_menu_icon(super::MenuIcon::Settings, super::MenuIconTheme::Light);

        assert!(alpha_at_scaled(&image, 10.0, 4.1) > 100);
        assert!(alpha_at_scaled(&image, 14.0, 4.1) > 100);
        assert!(alpha_at_scaled(&image, 12.0, 12.0) < 20);
        assert!(alpha_at_scaled(&image, 17.6, 6.2) > 100);
    }

    #[test]
    fn transparent_menu_icon_reserves_an_empty_icon_slot() {
        let image = super::transparent_menu_icon();

        assert_eq!((image.width(), image.height()), (36, 36));
        assert!(image.rgba().chunks_exact(4).all(|pixel| pixel[3] == 0));
    }

    fn average_visible_luma(image: &tauri::image::Image<'_>) -> f32 {
        let mut total = 0.0;
        let mut count = 0;
        for pixel in image.rgba().chunks_exact(4).filter(|pixel| pixel[3] > 0) {
            total += pixel[0] as f32 * 0.2126 + pixel[1] as f32 * 0.7152 + pixel[2] as f32 * 0.0722;
            count += 1;
        }

        total / count as f32
    }

    fn scaled_icon_coordinate(coordinate: f32) -> f32 {
        const LUCIDE_GLYPH_SCALE: f32 = 0.8;

        12.0 + (coordinate - 12.0) * LUCIDE_GLYPH_SCALE
    }

    fn alpha_at_scaled(image: &tauri::image::Image<'_>, logical_x: f32, logical_y: f32) -> u8 {
        alpha_at(
            image,
            scaled_icon_coordinate(logical_x),
            scaled_icon_coordinate(logical_y),
        )
    }

    fn alpha_bounds(
        image: &tauri::image::Image<'_>,
        threshold: u8,
    ) -> Option<(u32, u32, u32, u32)> {
        let mut min_x = image.width();
        let mut min_y = image.height();
        let mut max_x = 0;
        let mut max_y = 0;
        let mut found = false;

        for y in 0..image.height() {
            for x in 0..image.width() {
                let index = ((y * image.width() + x) * 4 + 3) as usize;
                if image.rgba()[index] < threshold {
                    continue;
                }

                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                found = true;
            }
        }

        found.then_some((min_x, min_y, max_x, max_y))
    }

    fn alpha_at(image: &tauri::image::Image<'_>, logical_x: f32, logical_y: f32) -> u8 {
        let scale = image.width() as f32 / 24.0;
        let x = (logical_x * scale).floor() as u32;
        let y = (logical_y * scale).floor() as u32;
        let index = ((y * image.width() + x) * 4 + 3) as usize;

        image.rgba()[index]
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn menu_accelerators_use_macos_names() {
        assert_eq!(super::settings_menu_accelerator(), Some("Cmd+,"));
        assert_eq!(super::quit_menu_accelerator(), Some("Cmd+Q"));
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn menu_accelerators_use_control_names() {
        assert_eq!(super::settings_menu_accelerator(), Some("Ctrl+,"));
        assert_eq!(super::quit_menu_accelerator(), Some("Ctrl+Q"));
    }
}
