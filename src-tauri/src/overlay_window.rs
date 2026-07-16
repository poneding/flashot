use crate::types::Rect;
use anyhow::{anyhow, Result};
use std::sync::mpsc;
use tauri::{AppHandle, CursorIcon, Manager, WebviewWindow};

pub fn configure_capture_overlay(
    window: &WebviewWindow,
    monitor_id: u32,
    monitor_rect: Rect,
) -> Result<()> {
    run_on_window_main_thread(window, "configure capture overlay", move |window| {
        configure_platform_overlay(window, monitor_id, monitor_rect)
    })
}

pub fn bring_capture_overlay_to_front(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "bring capture overlay to front", |window| {
        bring_platform_overlay_to_front(window)
    })
}

pub fn bring_all_capture_overlays_to_front(app: &AppHandle) {
    for (_label, window) in app.webview_windows() {
        let label = window.label();
        if label.starts_with("overlay-chrome-") || !label.starts_with("overlay-") {
            continue;
        }

        if let Err(e) = bring_capture_overlay_to_front(&window) {
            tracing::warn!("failed to bring capture overlay {label} to front: {e}");
        }
    }
}

pub fn show_capture_overlay(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "show capture overlay", |window| {
        show_platform_overlay(window)
    })
}

pub fn reveal_capture_overlays(app: &AppHandle, monitor_ids: &[u32]) -> Result<()> {
    tracing::info!("revealing capture overlays: monitors={monitor_ids:?}");
    let windows = monitor_ids
        .iter()
        .filter_map(|monitor_id| app.get_webview_window(&format!("overlay-{monitor_id}")))
        .collect::<Vec<_>>();

    // Prime tao/wry's own cursor state before AppKit maps the windows. Without
    // this, the newly-fronted WebView briefly contributes its default arrow
    // cursor rect before the process-global NSCursor correction runs.
    for window in &windows {
        if let Err(e) = window.set_cursor_icon(CursorIcon::Crosshair) {
            tracing::warn!("failed to prime capture window cursor: {e}");
        }
    }

    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = (|| {
                // Keep AppKit's intermediate arrow cursor invisible while
                // ownership moves from the previous app to the capture
                // overlays. This guard lasts only for the native reveal
                // transaction, not for screen capture or image preloading.
                let _cursor_visibility = PlatformCursorVisibilityGuard::hide();
                crate::app_activation::activate_flashot_on_main_thread();
                for window in &windows {
                    set_platform_overlay_alpha(window, 1.0)?;
                    set_platform_cursor_events(window, true)?;
                    set_platform_crosshair_cursor_rect(window)?;
                    display_platform_overlay_if_needed(window)?;
                    bring_platform_overlay_to_front(window)?;
                    set_platform_crosshair_cursor_rect(window)?;
                }
                push_crosshair_cursor();
                Ok(())
            })();
            let _ = tx.send(result);
        })?;
        let result = rx
            .recv()
            .map_err(|_| anyhow!("reveal capture overlays did not return from the main thread"))?;
        if result.is_ok() {
            tracing::info!("capture overlays revealed");
        }
        result
    }

    #[cfg(not(target_os = "macos"))]
    {
        for window in windows {
            #[cfg(not(target_os = "linux"))]
            window.set_ignore_cursor_events(false)?;
            show_capture_overlay(&window)?;
            if capture_overlay_should_take_focus() {
                let _ = window.set_focus();
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
struct PlatformCursorVisibilityGuard {
    hidden: bool,
}

#[cfg(target_os = "macos")]
impl PlatformCursorVisibilityGuard {
    fn hide() -> Self {
        let hidden = unsafe { CGDisplayHideCursor(0) } == 0;
        if !hidden {
            tracing::warn!("failed to hide cursor during capture overlay reveal");
        }
        Self { hidden }
    }
}

#[cfg(target_os = "macos")]
impl Drop for PlatformCursorVisibilityGuard {
    fn drop(&mut self) {
        if self.hidden && unsafe { CGDisplayShowCursor(0) } != 0 {
            tracing::warn!("failed to restore cursor after capture overlay reveal");
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayHideCursor(display: u32) -> i32;
    fn CGDisplayShowCursor(display: u32) -> i32;
}

pub fn prepare_overlay_text_input(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "prepare overlay text input", |window| {
        prepare_platform_text_input(window)
    })
}

pub fn restore_overlay_after_text_input(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "restore overlay after text input", |window| {
        restore_platform_after_text_input(window)
    })
}

pub fn board_toolbar_top_inset(window: &WebviewWindow) -> Result<f64> {
    #[cfg(target_os = "macos")]
    {
        run_on_window_main_thread(window, "read board toolbar safe area", |window| {
            macos_screen_safe_area_top(window)
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(0.0)
    }
}

pub fn capture_overlay_accepts_first_mouse() -> bool {
    true
}

/// Re-assert the capture cursor after all overlays are visible. macOS only;
/// no-op elsewhere (other platforms honor the webview CSS cursor).
/// Must run on the main thread; dispatch via `run_on_main_thread`.
pub fn push_capture_cursor() {
    #[cfg(target_os = "macos")]
    push_crosshair_cursor();
}

pub fn push_capture_cursor_for_style(cursor: &str) {
    #[cfg(target_os = "macos")]
    push_macos_cursor(cursor);
    #[cfg(not(target_os = "macos"))]
    let _ = cursor;
}

#[cfg(target_os = "macos")]
pub fn capture_overlay_should_take_focus() -> bool {
    // Activating the app so the overlay can become key also lets macOS
    // reorder existing Flashot utility windows. Keep capture overlays
    // visually frontmost on macOS without changing the active app.
    false
}

#[cfg(not(target_os = "macos"))]
pub fn capture_overlay_should_take_focus() -> bool {
    true
}

#[cfg(all(target_os = "macos", test))]
const NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK: usize = 1 << 0;
#[cfg(all(target_os = "macos", test))]
const NS_APPLICATION_PRESENTATION_HIDE_DOCK: usize = 1 << 1;
#[cfg(all(target_os = "macos", test))]
const NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR: usize = 1 << 2;
#[cfg(all(target_os = "macos", test))]
const NS_APPLICATION_PRESENTATION_HIDE_MENU_BAR: usize = 1 << 3;

#[cfg(target_os = "macos")]
fn overlay_level_from_window_levels(shielding_level: isize, maximum_level: isize) -> isize {
    maximum_level.max(shielding_level + 1)
}

#[cfg(any(target_os = "macos", test))]
fn text_input_overlay_level_from_popup_level(popup_level: isize) -> isize {
    popup_level - 1
}

#[cfg(all(target_os = "macos", test))]
fn capture_presentation_options(current: usize) -> usize {
    current
}

fn run_on_window_main_thread<T, F>(
    window: &WebviewWindow,
    task_name: &'static str,
    task: F,
) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&WebviewWindow) -> Result<T> + Send + 'static,
{
    let task_window = window.clone();
    let (tx, rx) = mpsc::sync_channel(1);

    window.run_on_main_thread(move || {
        let result = task(&task_window);
        let _ = tx.send(result);
    })?;

    rx.recv()
        .map_err(|_| anyhow!("{task_name} did not return from the main thread"))?
}

#[cfg(target_os = "macos")]
fn configure_platform_overlay(
    window: &WebviewWindow,
    monitor_id: u32,
    _monitor_rect: Rect,
) -> Result<()> {
    use objc::{
        runtime::{Object, Sel, NO, YES},
        Message,
    };

    const NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY: usize = 1 << 4;
    const NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    let ns_window = window.ns_window()? as *mut Object;
    let behavior = NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
        | NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY
        | NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY;

    unsafe {
        let ns_window = &*ns_window;
        ns_window.send_message::<_, ()>(
            Sel::register("setLevel:"),
            (capture_overlay_window_level(),),
        )?;
        ns_window.send_message::<_, ()>(Sel::register("setCollectionBehavior:"), (behavior,))?;
        ns_window.send_message::<_, ()>(Sel::register("setAcceptsMouseMovedEvents:"), (YES,))?;
        ns_window.send_message::<_, ()>(Sel::register("setHasShadow:"), (NO,))?;
        ns_window.send_message::<_, ()>(Sel::register("setOpaque:"), (NO,))?;
        if let Some(frame) = screen_frame_for_monitor(monitor_id)? {
            ns_window.send_message::<_, ()>(Sel::register("setFrame:display:"), (frame, YES))?;
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_platform_cursor_events(window: &WebviewWindow, enabled: bool) -> Result<()> {
    use objc::{
        runtime::{Object, Sel, NO, YES},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        (&*ns_window).send_message::<_, ()>(
            Sel::register("setIgnoresMouseEvents:"),
            (if enabled { NO } else { YES },),
        )?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_platform_overlay_alpha(window: &WebviewWindow, alpha: f64) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        (&*ns_window).send_message::<_, ()>(Sel::register("setAlphaValue:"), (alpha,))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn display_platform_overlay_if_needed(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        (&*ns_window).send_message::<_, ()>(Sel::register("displayIfNeeded"), ())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_platform_crosshair_cursor_rect(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let content_view: *mut Object = (&*ns_window)
            .send_message(Sel::register("contentView"), ())?;
        if content_view.is_null() {
            return Ok(());
        }
        let Some(cursor_class) = Class::get("NSCursor") else {
            return Ok(());
        };
        let cursor: *mut Object = cursor_class
            .send_message(Sel::register("crosshairCursor"), ())?;
        if cursor.is_null() {
            return Ok(());
        }
        let bounds: NSRect = (&*content_view).send_message(Sel::register("bounds"), ())?;
        (&*content_view).send_message::<_, ()>(Sel::register("discardCursorRects"), ())?;
        (&*content_view).send_message::<_, ()>(
            Sel::register("addCursorRect:cursor:"),
            (bounds, cursor),
        )?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn show_platform_overlay(window: &WebviewWindow) -> Result<()> {
    set_platform_overlay_alpha(window, 1.0)?;
    bring_platform_overlay_to_front(window)?;
    push_crosshair_cursor();
    Ok(())
}

#[cfg(target_os = "macos")]
fn bring_platform_overlay_to_front(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        // Bring the overlay to the front visually without activating
        // Flashot. Activating the app can reorder already-open utility
        // windows like Settings, About, or Updater.
        let ns_window = &*ns_window;
        ns_window.send_message::<_, ()>(
            Sel::register("setLevel:"),
            (capture_overlay_window_level(),),
        )?;
        ns_window.send_message::<_, ()>(Sel::register("orderFrontRegardless"), ())?;
    }

    Ok(())
}

/// Force the crosshair cursor at the AppKit level when a capture overlay is
/// shown. Overlays are deliberately shown without activating Flashot (see
/// `capture_overlay_should_take_focus`), so the overlay never becomes key and
/// macOS/WebKit does not honor its CSS/webview cursor while another app stays
/// active. `[NSCursor set]` is process-global and works without activation,
/// bridging the gap until the user interacts with the overlay. NSCursor is
/// main-thread-only; callers reach this via `run_on_window_main_thread` or
/// `run_on_main_thread`, which satisfies that requirement.
#[cfg(target_os = "macos")]
fn push_crosshair_cursor() {
    push_macos_cursor("crosshair");
}

#[cfg(any(target_os = "macos", test))]
fn macos_cursor_selector(cursor: &str) -> &'static str {
    match cursor {
        "crosshair" => "crosshairCursor",
        "text" => "IBeamCursor",
        "move" | "grab" => "openHandCursor",
        "grabbing" => "closedHandCursor",
        "zoom-in" => "_zoomInCursor",
        "nwse-resize" => "_windowResizeNorthWestSouthEastCursor",
        "nesw-resize" => "_windowResizeNorthEastSouthWestCursor",
        "ns-resize" => "resizeUpDownCursor",
        "ew-resize" => "resizeLeftRightCursor",
        _ => "arrowCursor",
    }
}

#[cfg(target_os = "macos")]
fn push_macos_cursor(cursor_style: &str) {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    unsafe {
        let Some(cursor_class) = Class::get("NSCursor") else {
            return;
        };
        let requested_selector = Sel::register(macos_cursor_selector(cursor_style));
        let supports_requested: bool = cursor_class
            .send_message(Sel::register("respondsToSelector:"), (requested_selector,))
            .unwrap_or(false);
        let cursor_selector = if supports_requested {
            requested_selector
        } else {
            Sel::register("arrowCursor")
        };
        let cursor: *mut Object =
            match cursor_class.send_message(cursor_selector, ()) {
                Ok(cursor) => cursor,
                Err(e) => {
                    tracing::warn!("NSCursor update failed for {cursor_style}: {e}");
                    return;
                }
            };
        if cursor.is_null() {
            return;
        }
        if let Err(e) = (*cursor).send_message::<_, ()>(Sel::register("set"), ()) {
            tracing::warn!("NSCursor set failed: {e}");
        }
    }
}

#[cfg(target_os = "macos")]
fn prepare_platform_text_input(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let ns_window = &*ns_window;
        ns_window.send_message::<_, ()>(
            Sel::register("setLevel:"),
            (text_input_overlay_window_level(),),
        )?;

        ns_window.send_message::<_, ()>(
            Sel::register("makeKeyAndOrderFront:"),
            (std::ptr::null_mut::<Object>(),),
        )?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_platform_after_text_input(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let ns_window = &*ns_window;
        ns_window.send_message::<_, ()>(
            Sel::register("setLevel:"),
            (capture_overlay_window_level(),),
        )?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn capture_overlay_window_level() -> isize {
    unsafe extern "C" {
        fn CGShieldingWindowLevel() -> i32;
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    const K_CG_MAXIMUM_WINDOW_LEVEL_KEY: i32 = 14;

    unsafe {
        overlay_level_from_window_levels(
            CGShieldingWindowLevel() as isize,
            CGWindowLevelForKey(K_CG_MAXIMUM_WINDOW_LEVEL_KEY) as isize,
        )
    }
}

#[cfg(target_os = "macos")]
fn text_input_overlay_window_level() -> isize {
    unsafe extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    const K_CG_POP_UP_MENU_WINDOW_LEVEL_KEY: i32 = 11;

    unsafe {
        text_input_overlay_level_from_popup_level(CGWindowLevelForKey(
            K_CG_POP_UP_MENU_WINDOW_LEVEL_KEY,
        ) as isize)
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NSPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NSSize {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NSRect {
    origin: NSPoint,
    size: NSSize,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NSEdgeInsets {
    top: f64,
    left: f64,
    bottom: f64,
    right: f64,
}

#[cfg(target_os = "macos")]
fn macos_screen_safe_area_top(window: &WebviewWindow) -> Result<f64> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let screen: *mut Object = (*ns_window).send_message(Sel::register("screen"), ())?;
        if screen.is_null() {
            return Ok(0.0);
        }

        let safe_area_selector = Sel::register("safeAreaInsets");
        let supports_safe_area: bool =
            (*screen).send_message(Sel::register("respondsToSelector:"), (safe_area_selector,))?;
        if !supports_safe_area {
            return Ok(0.0);
        }

        let insets: NSEdgeInsets = (*screen).send_message(safe_area_selector, ())?;
        Ok(insets.top.max(0.0))
    }
}

#[cfg(target_os = "macos")]
fn screen_frame_for_monitor(monitor_id: u32) -> Result<Option<NSRect>> {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };
    use std::ffi::CString;

    let screen_class = Class::get("NSScreen").ok_or_else(|| anyhow!("NSScreen class not found"))?;
    let string_class = Class::get("NSString").ok_or_else(|| anyhow!("NSString class not found"))?;
    let screen_number_key = CString::new("NSScreenNumber")?;

    unsafe {
        let screens: *mut Object = screen_class.send_message(Sel::register("screens"), ())?;
        if screens.is_null() {
            return Ok(None);
        }

        let key: *mut Object = string_class.send_message(
            Sel::register("stringWithUTF8String:"),
            (screen_number_key.as_ptr(),),
        )?;
        let count: usize = (*screens).send_message(Sel::register("count"), ())?;

        for index in 0..count {
            let screen: *mut Object =
                (*screens).send_message(Sel::register("objectAtIndex:"), (index,))?;
            if screen.is_null() {
                continue;
            }

            let description: *mut Object =
                (*screen).send_message(Sel::register("deviceDescription"), ())?;
            if description.is_null() {
                continue;
            }

            let number: *mut Object =
                (*description).send_message(Sel::register("objectForKey:"), (key,))?;
            if number.is_null() {
                continue;
            }

            let screen_id: u32 = (*number).send_message(Sel::register("unsignedIntValue"), ())?;
            if screen_id == monitor_id {
                let frame: NSRect = (*screen).send_message(Sel::register("frame"), ())?;
                return Ok(Some(frame));
            }
        }
    }

    Ok(None)
}

#[cfg(target_os = "linux")]
fn show_platform_overlay(window: &WebviewWindow) -> Result<()> {
    window
        .show()
        .map_err(|e| anyhow!("failed to show overlay: {e}"))
}

#[cfg(target_os = "linux")]
fn configure_platform_overlay(
    window: &WebviewWindow,
    monitor_id: u32,
    monitor_rect: Rect,
) -> Result<()> {
    if is_linux_wayland_session() {
        if let Some(layer_shell) = linux_layer_shell() {
            configure_linux_layer_shell(window, monitor_id, monitor_rect, layer_shell)
        } else {
            configure_linux_wayland_fullscreen_fallback(window, monitor_rect)
        }
    } else {
        configure_linux_x11_overlay(window, monitor_rect)
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_layer_shell(
    window: &WebviewWindow,
    monitor_id: u32,
    monitor_rect: Rect,
    layer_shell: &GtkLayerShell,
) -> Result<()> {
    use gtk::glib::object::ObjectType;
    use std::ffi::CString;

    let gtk_window = window
        .gtk_window()
        .map_err(|e| anyhow!("failed to access GTK overlay window: {e}"))?;
    let gtk_ptr = gtk_window.as_ptr() as *mut gtk::ffi::GtkWindow;

    if !layer_shell.is_layer_window(gtk_ptr) {
        layer_shell.init_for_window(gtk_ptr);
    }

    let namespace = CString::new(format!("flashot-overlay-{monitor_id}"))?;
    layer_shell.set_namespace(gtk_ptr, namespace.as_ptr());
    layer_shell.set_layer(gtk_ptr, GTK_LAYER_SHELL_LAYER_OVERLAY);
    layer_shell.set_exclusive_zone(gtk_ptr, 0);
    layer_shell.set_keyboard_mode(gtk_ptr, GTK_LAYER_SHELL_KEYBOARD_MODE_EXCLUSIVE);

    for edge in [
        GTK_LAYER_SHELL_EDGE_LEFT,
        GTK_LAYER_SHELL_EDGE_RIGHT,
        GTK_LAYER_SHELL_EDGE_TOP,
        GTK_LAYER_SHELL_EDGE_BOTTOM,
    ] {
        layer_shell.set_anchor(gtk_ptr, edge, true);
        layer_shell.set_margin(gtk_ptr, edge, 0);
    }

    if let Some((monitor, _index)) = gdk_monitor_for_capture_rect(&gtk_window, monitor_rect) {
        layer_shell.set_monitor(gtk_ptr, monitor.as_ptr());
    } else {
        tracing::warn!(
            "failed to map capture monitor {monitor_id} to a GDK monitor for layer-shell"
        );
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_linux_x11_overlay(window: &WebviewWindow, monitor_rect: Rect) -> Result<()> {
    use gtk::prelude::*;

    let gtk_window = window
        .gtk_window()
        .map_err(|e| anyhow!("failed to access GTK overlay window: {e}"))?;

    gtk_window.set_type_hint(gdk::WindowTypeHint::Splashscreen);
    gtk_window.set_decorated(false);
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_keep_above(true);
    gtk_window.stick();
    fullscreen_linux_overlay_on_monitor(&gtk_window, monitor_rect);

    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_linux_wayland_fullscreen_fallback(
    window: &WebviewWindow,
    monitor_rect: Rect,
) -> Result<()> {
    tracing::warn!(
        "Wayland compositor does not support layer-shell; using monitor fullscreen fallback"
    );

    let gtk_window = window
        .gtk_window()
        .map_err(|e| anyhow!("failed to access GTK overlay window: {e}"))?;

    fullscreen_linux_overlay_on_monitor(&gtk_window, monitor_rect);

    Ok(())
}

#[cfg(target_os = "linux")]
fn fullscreen_linux_overlay_on_monitor(gtk_window: &gtk::ApplicationWindow, monitor_rect: Rect) {
    use gtk::prelude::*;

    if let (Some(screen), Some((_monitor, index))) = (
        gtk::prelude::GtkWindowExt::screen(gtk_window),
        gdk_monitor_for_capture_rect(gtk_window, monitor_rect),
    ) {
        gtk_window.fullscreen_on_monitor(&screen, index);
    } else {
        gtk_window.fullscreen();
    }
}

#[cfg(target_os = "linux")]
fn gdk_monitor_for_capture_rect(
    gtk_window: &gtk::ApplicationWindow,
    rect: Rect,
) -> Option<(gdk::Monitor, i32)> {
    use gdk::prelude::*;
    use gtk::prelude::*;

    let display = gtk_window.display();
    let mut best: Option<(gdk::Monitor, i32, i64)> = None;

    for index in 0..display.n_monitors() {
        let Some(monitor) = display.monitor(index) else {
            continue;
        };
        let geometry = monitor.geometry();
        let area = overlap_area(
            rect,
            Rect {
                x: geometry.x(),
                y: geometry.y(),
                width: geometry.width().max(0) as u32,
                height: geometry.height().max(0) as u32,
            },
        );

        if area > best.as_ref().map(|(_, _, area)| *area).unwrap_or(0) {
            best = Some((monitor, index, area));
        }
    }

    best.and_then(|(monitor, index, area)| (area > 0).then_some((monitor, index)))
}

#[cfg(target_os = "linux")]
fn overlap_area(a: Rect, b: Rect) -> i64 {
    let left = a.x.max(b.x) as i64;
    let top = a.y.max(b.y) as i64;
    let right = (a.x as i64 + a.width as i64).min(b.x as i64 + b.width as i64);
    let bottom = (a.y as i64 + a.height as i64).min(b.y as i64 + b.height as i64);

    let width = (right - left).max(0);
    let height = (bottom - top).max(0);
    width * height
}

#[cfg(target_os = "linux")]
type GtkLayerShellEdge = std::os::raw::c_int;
#[cfg(target_os = "linux")]
type GtkLayerShellLayer = std::os::raw::c_int;
#[cfg(target_os = "linux")]
type GtkLayerShellKeyboardMode = std::os::raw::c_int;
#[cfg(target_os = "linux")]
type GtkLayerShellBool = std::os::raw::c_int;

#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_EDGE_LEFT: GtkLayerShellEdge = 0;
#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_EDGE_RIGHT: GtkLayerShellEdge = 1;
#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_EDGE_TOP: GtkLayerShellEdge = 2;
#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_EDGE_BOTTOM: GtkLayerShellEdge = 3;
#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_KEYBOARD_MODE_EXCLUSIVE: GtkLayerShellKeyboardMode = 1;
#[cfg(target_os = "linux")]
const GTK_LAYER_SHELL_LAYER_OVERLAY: GtkLayerShellLayer = 3;

#[cfg(target_os = "linux")]
struct GtkLayerShell {
    _lib: libloading::Library,
    init_for_window: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow),
    is_layer_window: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow) -> GtkLayerShellBool,
    is_supported: unsafe extern "C" fn() -> GtkLayerShellBool,
    set_anchor:
        unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, GtkLayerShellEdge, GtkLayerShellBool),
    set_exclusive_zone: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, std::os::raw::c_int),
    set_keyboard_mode: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, GtkLayerShellKeyboardMode),
    set_layer: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, GtkLayerShellLayer),
    set_margin:
        unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, GtkLayerShellEdge, std::os::raw::c_int),
    set_monitor: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, *mut gdk::ffi::GdkMonitor),
    set_namespace: unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, *const std::os::raw::c_char),
}

#[cfg(target_os = "linux")]
impl GtkLayerShell {
    fn load() -> Result<Self> {
        let lib = unsafe {
            libloading::Library::new("libgtk-layer-shell.so.0")
                .or_else(|_| libloading::Library::new("libgtk-layer-shell.so"))
        }
        .map_err(|e| anyhow!("gtk-layer-shell library is not installed: {e}"))?;

        unsafe {
            Ok(Self {
                init_for_window: *lib.get(b"gtk_layer_init_for_window")?,
                is_layer_window: *lib.get(b"gtk_layer_is_layer_window")?,
                is_supported: *lib.get(b"gtk_layer_is_supported")?,
                set_anchor: *lib.get(b"gtk_layer_set_anchor")?,
                set_exclusive_zone: *lib.get(b"gtk_layer_set_exclusive_zone")?,
                set_keyboard_mode: *lib.get(b"gtk_layer_set_keyboard_mode")?,
                set_layer: *lib.get(b"gtk_layer_set_layer")?,
                set_margin: *lib.get(b"gtk_layer_set_margin")?,
                set_monitor: *lib.get(b"gtk_layer_set_monitor")?,
                set_namespace: *lib.get(b"gtk_layer_set_namespace")?,
                _lib: lib,
            })
        }
    }

    fn is_supported(&self) -> bool {
        unsafe { (self.is_supported)() != 0 }
    }

    fn is_layer_window(&self, window: *mut gtk::ffi::GtkWindow) -> bool {
        unsafe { (self.is_layer_window)(window) != 0 }
    }

    fn init_for_window(&self, window: *mut gtk::ffi::GtkWindow) {
        unsafe { (self.init_for_window)(window) };
    }

    fn set_anchor(
        &self,
        window: *mut gtk::ffi::GtkWindow,
        edge: GtkLayerShellEdge,
        anchor_to_edge: bool,
    ) {
        unsafe { (self.set_anchor)(window, edge, anchor_to_edge as GtkLayerShellBool) };
    }

    fn set_exclusive_zone(&self, window: *mut gtk::ffi::GtkWindow, exclusive_zone: i32) {
        unsafe { (self.set_exclusive_zone)(window, exclusive_zone) };
    }

    fn set_keyboard_mode(&self, window: *mut gtk::ffi::GtkWindow, mode: GtkLayerShellKeyboardMode) {
        unsafe { (self.set_keyboard_mode)(window, mode) };
    }

    fn set_layer(&self, window: *mut gtk::ffi::GtkWindow, layer: GtkLayerShellLayer) {
        unsafe { (self.set_layer)(window, layer) };
    }

    fn set_margin(&self, window: *mut gtk::ffi::GtkWindow, edge: GtkLayerShellEdge, margin: i32) {
        unsafe { (self.set_margin)(window, edge, margin) };
    }

    fn set_monitor(&self, window: *mut gtk::ffi::GtkWindow, monitor: *mut gdk::ffi::GdkMonitor) {
        unsafe { (self.set_monitor)(window, monitor) };
    }

    fn set_namespace(
        &self,
        window: *mut gtk::ffi::GtkWindow,
        namespace: *const std::os::raw::c_char,
    ) {
        unsafe { (self.set_namespace)(window, namespace) };
    }
}

#[cfg(target_os = "linux")]
fn linux_layer_shell() -> Option<&'static GtkLayerShell> {
    static LAYER_SHELL: once_cell::sync::OnceCell<Option<GtkLayerShell>> =
        once_cell::sync::OnceCell::new();

    let layer_shell = LAYER_SHELL.get_or_init(|| match GtkLayerShell::load() {
        Ok(layer_shell) => {
            if layer_shell.is_supported() {
                Some(layer_shell)
            } else {
                tracing::warn!("Wayland compositor does not support gtk-layer-shell");
                None
            }
        }
        Err(e) => {
            tracing::warn!("{e:#}");
            None
        }
    });

    layer_shell.as_ref()
}

#[cfg(target_os = "linux")]
fn is_linux_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|session| session.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(target_os = "linux")]
fn prepare_platform_text_input(window: &WebviewWindow) -> Result<()> {
    window
        .set_focus()
        .map_err(|e| anyhow!("failed to focus overlay for text input: {e}"))
}

#[cfg(target_os = "linux")]
fn restore_platform_after_text_input(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn show_platform_overlay(window: &WebviewWindow) -> Result<()> {
    window
        .show()
        .map_err(|e| anyhow!("failed to show overlay: {e}"))
}

#[cfg(target_os = "windows")]
fn configure_platform_overlay(
    _window: &WebviewWindow,
    _monitor_id: u32,
    _monitor_rect: Rect,
) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn prepare_platform_text_input(window: &WebviewWindow) -> Result<()> {
    window
        .set_focus()
        .map_err(|e| anyhow!("failed to focus overlay for text input: {e}"))
}

#[cfg(target_os = "windows")]
fn restore_platform_after_text_input(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn capture_overlay_accepts_first_mouse_clicks() {
        assert!(super::capture_overlay_accepts_first_mouse());
    }

    #[test]
    fn text_input_overlay_level_sits_below_ime_popup_windows() {
        assert_eq!(super::text_input_overlay_level_from_popup_level(101), 100);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_capture_overlay_does_not_activate_app() {
        assert!(!super::capture_overlay_should_take_focus());
    }

    #[test]
    fn macos_overlay_activation_does_not_raise_all_app_windows() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let body = function_body(&source, "bring_platform_overlay_to_front");

        assert!(
            body.contains("orderFrontRegardless"),
            "capture overlays should still be visually raised above the screen",
        );
        assert!(
            body.contains("setLevel:") && body.contains("capture_overlay_window_level()"),
            "capture overlays must reassert their maximum window level whenever they are raised",
        );
        assert!(
            !body.contains("activateIgnoringOtherApps:") && !body.contains("activateWithOptions:"),
            "activateIgnoringOtherApps brings existing settings/about/updater windows forward during capture",
        );
        assert!(
            !body.contains("makeKeyAndOrderFront:") && !body.contains("makeMainWindow"),
            "capture overlay fronting must not make the app key/main because that can reorder utility windows",
        );
    }

    #[test]
    fn macos_overlay_show_pushes_crosshair_cursor() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let body = function_body(&source, "show_platform_overlay");
        assert!(
            body.contains("push_crosshair_cursor();"),
            "showing a capture overlay must push the crosshair cursor without requiring app activation",
        );
    }

    #[test]
    fn macos_capture_reveal_hides_intermediate_cursor_until_crosshair_is_ready() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let body = function_body(&source, "reveal_capture_overlays");

        let activate = body
            .find("activate_flashot_on_main_thread()")
            .expect("capture reveal must activate Flashot for stable cursor ownership");
        let cursor = body
            .rfind("push_crosshair_cursor()")
            .expect("capture reveal must settle the cursor");
        let hide = body
            .find("PlatformCursorVisibilityGuard::hide()")
            .expect("capture reveal must hide AppKit's intermediate cursor");
        let visible = body
            .find("set_platform_overlay_alpha(window, 1.0)")
            .expect("capture reveal must restore window opacity");
        let front = body
            .find("bring_platform_overlay_to_front(window)")
            .expect("capture reveal must map the prepared window");
        assert!(hide < activate && activate < visible && visible < front && front < cursor);
        assert!(body.contains("display_platform_overlay_if_needed(window)"));
        assert!(body.contains("set_platform_crosshair_cursor_rect(window)"));
        assert!(body.contains("window.set_cursor_icon(CursorIcon::Crosshair)"));
    }

    #[test]
    fn macos_reveal_cursor_visibility_guard_balances_hide_and_show() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");

        assert!(source.contains("CGDisplayHideCursor"));
        assert!(source.contains("impl Drop for PlatformCursorVisibilityGuard"));
        assert!(source.contains("CGDisplayShowCursor"));
    }

    #[test]
    fn macos_capture_cursor_rect_uses_crosshair_not_webview_default() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let body = function_body(&source, "set_platform_crosshair_cursor_rect");

        assert!(body.contains("crosshairCursor"));
        assert!(body.contains("discardCursorRects"));
        assert!(body.contains("addCursorRect:cursor:"));
    }

    #[test]
    fn macos_capture_cursor_maps_annotation_tool_styles() {
        assert_eq!(super::macos_cursor_selector("crosshair"), "crosshairCursor");
        assert_eq!(super::macos_cursor_selector("text"), "IBeamCursor");
        assert_eq!(super::macos_cursor_selector("grab"), "openHandCursor");
        assert_eq!(super::macos_cursor_selector("grabbing"), "closedHandCursor");
        assert_eq!(super::macos_cursor_selector("zoom-in"), "_zoomInCursor");
        assert_eq!(super::macos_cursor_selector("unknown"), "arrowCursor");
    }

    #[test]
    fn board_toolbar_uses_actual_macos_notch_safe_area() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let macos_body = function_body(&source, "macos_screen_safe_area_top");

        assert!(macos_body.contains("safeAreaInsets"));
        assert!(macos_body.contains("respondsToSelector:"));
        assert!(macos_body.contains("insets.top.max(0.0)"));
        assert!(!macos_body.contains("model") && !macos_body.contains("arch"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn non_macos_capture_overlay_can_take_focus() {
        assert!(super::capture_overlay_should_take_focus());
    }

    #[test]
    fn linux_overlay_prefers_wayland_layer_shell() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let start = source
            .find("#[cfg(target_os = \"linux\")]\nfn configure_platform_overlay")
            .unwrap();
        let end = source[start..]
            .find("#[cfg(target_os = \"linux\")]\nfn bring_platform_overlay_to_front")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            body.contains("if is_linux_wayland_session()")
                && body.contains("linux_layer_shell()")
                && body.contains("configure_linux_layer_shell")
                && body.contains("configure_linux_wayland_fullscreen_fallback")
                && body.contains("configure_linux_x11_overlay(window, monitor_rect)")
                && body.contains("GTK_LAYER_SHELL_LAYER_OVERLAY")
                && body.contains("set_anchor(gtk_ptr, edge, true)"),
            "Wayland overlays should use layer-shell without stealing the X11 fullscreen path"
        );
    }

    #[test]
    fn linux_x11_overlay_uses_monitor_fullscreen() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let x11_body = function_body(&source, "configure_linux_x11_overlay");
        let fullscreen_body = function_body(&source, "fullscreen_linux_overlay_on_monitor");

        assert!(
            x11_body.contains("set_type_hint(gdk::WindowTypeHint::Splashscreen)")
                && x11_body.contains("set_keep_above(true)")
                && x11_body.contains("stick()")
                && x11_body.contains("fullscreen_linux_overlay_on_monitor"),
            "X11 overlays must be configured as screen-covering utility windows"
        );
        assert!(
            fullscreen_body.contains("fullscreen_on_monitor")
                && fullscreen_body.contains("gtk_window.fullscreen()"),
            "X11 overlays need monitor fullscreen with a generic fullscreen fallback"
        );
    }

    #[test]
    fn linux_layer_shell_is_loaded_dynamically() {
        let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
        let impl_source = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source should be present");
        let cargo_toml = include_str!("../Cargo.toml");
        let tauri_config = include_str!("../tauri.conf.json");

        assert!(
            impl_source.contains("libloading::Library::new(\"libgtk-layer-shell.so.0\")"),
            "gtk-layer-shell must stay an optional runtime enhancement"
        );
        assert!(
            !impl_source.contains("use gtk_layer_shell")
                && !impl_source.contains("gtk_layer_shell::")
                && !cargo_toml.contains("gtk-layer-shell =")
                && !tauri_config.contains("libgtk-layer-shell0"),
            "deb installs should not require libgtk-layer-shell0"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_overlay_uses_maximum_window_level() {
        assert_eq!(super::overlay_level_from_window_levels(2000, 3000), 3000);
        assert_eq!(super::overlay_level_from_window_levels(2000, 1999), 2001);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn capture_presentation_does_not_mutate_system_chrome_options() {
        let preserved_option = 1 << 12;
        let existing = super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK
            | super::NS_APPLICATION_PRESENTATION_HIDE_DOCK
            | super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR
            | super::NS_APPLICATION_PRESENTATION_HIDE_MENU_BAR
            | preserved_option;

        let options = super::capture_presentation_options(existing);

        assert_eq!(options, existing);
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
