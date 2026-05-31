use crate::types::Rect;
use anyhow::{anyhow, Result};
use std::sync::mpsc;
use tauri::{AppHandle, WebviewWindow};

#[derive(Clone, Copy)]
pub struct ScrollRegionFrameColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

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

pub fn show_capture_overlay(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "show capture overlay", |window| {
        show_platform_overlay(window)
    })
}

pub fn show_wayland_scroll_region_frame(
    app: &AppHandle,
    monitor_id: u32,
    monitor_rect: Rect,
    selection: Rect,
    color: ScrollRegionFrameColor,
) -> Result<()> {
    show_platform_wayland_scroll_region_frame(app, monitor_id, monitor_rect, selection, color)
}

pub fn hide_wayland_scroll_region_frame(app: &AppHandle, monitor_id: u32) -> Result<()> {
    hide_platform_wayland_scroll_region_frame(app, monitor_id)
}

pub fn hide_all_wayland_scroll_region_frames(app: &AppHandle) -> Result<()> {
    hide_all_platform_wayland_scroll_region_frames(app)
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

pub fn capture_overlay_accepts_first_mouse() -> bool {
    true
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

fn run_on_window_main_thread<F>(
    window: &WebviewWindow,
    task_name: &'static str,
    task: F,
) -> Result<()>
where
    F: FnOnce(&WebviewWindow) -> Result<()> + Send + 'static,
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

#[cfg(target_os = "linux")]
fn run_on_app_main_thread<F>(app: &AppHandle, task_name: &'static str, task: F) -> Result<()>
where
    F: FnOnce() -> Result<()> + Send + 'static,
{
    let (tx, rx) = mpsc::sync_channel(1);

    app.run_on_main_thread(move || {
        let result = task();
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
fn show_platform_overlay(window: &WebviewWindow) -> Result<()> {
    bring_platform_overlay_to_front(window)
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
        ns_window.send_message::<_, ()>(Sel::register("orderFrontRegardless"), ())?;
    }

    Ok(())
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
    extern "C" {
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
    extern "C" {
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
    if !is_linux_wayland_session() {
        return Ok(());
    }

    if let Some(layer_shell) = linux_layer_shell() {
        configure_linux_layer_shell(window, monitor_id, monitor_rect, layer_shell)
    } else {
        configure_linux_fullscreen_fallback(window, monitor_rect)
    }
}

#[cfg(target_os = "linux")]
fn show_platform_wayland_scroll_region_frame(
    app: &AppHandle,
    monitor_id: u32,
    monitor_rect: Rect,
    selection: Rect,
    color: ScrollRegionFrameColor,
) -> Result<()> {
    if !is_linux_wayland_session() {
        return Ok(());
    }

    run_on_app_main_thread(app, "show wayland scroll region frame", move || {
        show_wayland_scroll_region_frame_on_main(monitor_id, monitor_rect, selection, color)
    })
}

#[cfg(not(target_os = "linux"))]
fn show_platform_wayland_scroll_region_frame(
    _app: &AppHandle,
    _monitor_id: u32,
    _monitor_rect: Rect,
    _selection: Rect,
    _color: ScrollRegionFrameColor,
) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn hide_platform_wayland_scroll_region_frame(app: &AppHandle, monitor_id: u32) -> Result<()> {
    if !is_linux_wayland_session() {
        return Ok(());
    }

    run_on_app_main_thread(app, "hide wayland scroll region frame", move || {
        hide_wayland_scroll_region_frame_on_main(monitor_id);
        Ok(())
    })
}

#[cfg(not(target_os = "linux"))]
fn hide_platform_wayland_scroll_region_frame(_app: &AppHandle, _monitor_id: u32) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn hide_all_platform_wayland_scroll_region_frames(app: &AppHandle) -> Result<()> {
    if !is_linux_wayland_session() {
        return Ok(());
    }

    run_on_app_main_thread(app, "hide all wayland scroll region frames", move || {
        hide_all_wayland_scroll_region_frames_on_main();
        Ok(())
    })
}

#[cfg(not(target_os = "linux"))]
fn hide_all_platform_wayland_scroll_region_frames(_app: &AppHandle) -> Result<()> {
    Ok(())
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
thread_local! {
    static WAYLAND_SCROLL_REGION_FRAMES: std::cell::RefCell<std::collections::HashMap<u32, gtk::Window>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

#[cfg(target_os = "linux")]
fn show_wayland_scroll_region_frame_on_main(
    monitor_id: u32,
    monitor_rect: Rect,
    selection: Rect,
    color: ScrollRegionFrameColor,
) -> Result<()> {
    use gtk::prelude::*;

    hide_wayland_scroll_region_frame_on_main(monitor_id);

    let Some(layer_shell) = linux_layer_shell() else {
        tracing::warn!(
            "Wayland scroll region frame skipped because gtk-layer-shell is unavailable"
        );
        return Ok(());
    };

    let segments = scroll_region_frame_segments(monitor_rect, selection, 2);
    let window = gtk::Window::new(gtk::WindowType::Popup);
    window.set_title("Flashot Scroll Region Frame");
    window.set_decorated(false);
    window.set_resizable(false);
    window.set_accept_focus(false);
    window.set_skip_taskbar_hint(true);
    window.set_skip_pager_hint(true);
    window.set_type_hint(gdk::WindowTypeHint::Notification);
    window.set_keep_above(true);
    window.set_app_paintable(true);
    window.set_default_size(monitor_rect.width as i32, monitor_rect.height as i32);

    if let Some(screen) = gtk::prelude::GtkWindowExt::screen(&window) {
        if let Some(visual) = screen.rgba_visual() {
            window.set_visual(Some(&visual));
        }
    }

    let area = gtk::DrawingArea::new();
    area.set_size_request(monitor_rect.width as i32, monitor_rect.height as i32);
    area.set_app_paintable(true);
    area.connect_draw(move |_, cr| {
        cr.set_operator(gtk::cairo::Operator::Source);
        cr.set_source_rgba(0.0, 0.0, 0.0, 0.0);
        let _ = cr.paint();
        cr.set_source_rgba(
            color.red as f64 / 255.0,
            color.green as f64 / 255.0,
            color.blue as f64 / 255.0,
            color.alpha as f64 / 255.0,
        );
        for segment in &segments {
            cr.rectangle(
                segment.x as f64,
                segment.y as f64,
                segment.width as f64,
                segment.height as f64,
            );
            let _ = cr.fill();
        }
        gtk::glib::Propagation::Stop
    });

    window.add(&area);
    configure_wayland_scroll_region_frame_window(&window, monitor_id, monitor_rect, layer_shell)?;
    window.connect_realize(|window| {
        if let Some(gdk_window) = window.window() {
            gdk_window.set_pass_through(true);
            gdk_window.set_accept_focus(false);
            gdk_window.set_skip_taskbar_hint(true);
            gdk_window.set_skip_pager_hint(true);
        }
    });
    window.show_all();

    WAYLAND_SCROLL_REGION_FRAMES.with(|frames| {
        frames.borrow_mut().insert(monitor_id, window);
    });

    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_wayland_scroll_region_frame_window(
    window: &gtk::Window,
    monitor_id: u32,
    monitor_rect: Rect,
    layer_shell: &GtkLayerShell,
) -> Result<()> {
    use gtk::glib::object::ObjectType;
    use gtk::prelude::*;
    use std::ffi::CString;

    let gtk_ptr = window.as_ptr();
    if !layer_shell.is_layer_window(gtk_ptr) {
        layer_shell.init_for_window(gtk_ptr);
    }

    let namespace = CString::new(format!("flashot-scroll-region-frame-{monitor_id}"))?;
    layer_shell.set_namespace(gtk_ptr, namespace.as_ptr());
    layer_shell.set_layer(gtk_ptr, GTK_LAYER_SHELL_LAYER_OVERLAY);
    layer_shell.set_exclusive_zone(gtk_ptr, 0);
    layer_shell.set_keyboard_mode(gtk_ptr, GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);
    for edge in [
        GTK_LAYER_SHELL_EDGE_LEFT,
        GTK_LAYER_SHELL_EDGE_RIGHT,
        GTK_LAYER_SHELL_EDGE_TOP,
        GTK_LAYER_SHELL_EDGE_BOTTOM,
    ] {
        layer_shell.set_anchor(gtk_ptr, edge, true);
        layer_shell.set_margin(gtk_ptr, edge, 0);
    }

    let display = window.display();
    if let Some((monitor, _index)) = gdk_monitor_for_display_rect(&display, monitor_rect) {
        layer_shell.set_monitor(gtk_ptr, monitor.as_ptr());
    } else {
        tracing::warn!("failed to map scroll region frame monitor {monitor_id} to a GDK monitor");
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn hide_wayland_scroll_region_frame_on_main(monitor_id: u32) {
    use gtk::prelude::*;

    WAYLAND_SCROLL_REGION_FRAMES.with(|frames| {
        if let Some(window) = frames.borrow_mut().remove(&monitor_id) {
            window.close();
        }
    });
}

#[cfg(target_os = "linux")]
fn hide_all_wayland_scroll_region_frames_on_main() {
    use gtk::prelude::*;

    WAYLAND_SCROLL_REGION_FRAMES.with(|frames| {
        for (_monitor_id, window) in frames.borrow_mut().drain() {
            window.close();
        }
    });
}

#[cfg(any(target_os = "linux", test))]
fn scroll_region_frame_segments(monitor_rect: Rect, selection: Rect, thickness: u32) -> Vec<Rect> {
    let mon_width = monitor_rect.width as i32;
    let mon_height = monitor_rect.height as i32;
    let left = selection.x.clamp(0, mon_width);
    let top = selection.y.clamp(0, mon_height);
    let right = (selection.x + selection.width as i32).clamp(0, mon_width);
    let bottom = (selection.y + selection.height as i32).clamp(0, mon_height);
    if right <= left || bottom <= top || thickness == 0 {
        return Vec::new();
    }

    let thickness = thickness as i32;
    let mut segments = Vec::with_capacity(4);

    let top_y = (top - thickness).max(0);
    push_positive_rect(
        &mut segments,
        Rect {
            x: left,
            y: top_y,
            width: (right - left) as u32,
            height: (top - top_y) as u32,
        },
    );

    let bottom_edge = (bottom + thickness).min(mon_height);
    push_positive_rect(
        &mut segments,
        Rect {
            x: left,
            y: bottom,
            width: (right - left) as u32,
            height: (bottom_edge - bottom) as u32,
        },
    );

    let left_x = (left - thickness).max(0);
    push_positive_rect(
        &mut segments,
        Rect {
            x: left_x,
            y: top,
            width: (left - left_x) as u32,
            height: (bottom - top) as u32,
        },
    );

    let right_edge = (right + thickness).min(mon_width);
    push_positive_rect(
        &mut segments,
        Rect {
            x: right,
            y: top,
            width: (right_edge - right) as u32,
            height: (bottom - top) as u32,
        },
    );

    segments
}

#[cfg(any(target_os = "linux", test))]
fn push_positive_rect(rects: &mut Vec<Rect>, rect: Rect) {
    if rect.width > 0 && rect.height > 0 {
        rects.push(rect);
    }
}

#[cfg(target_os = "linux")]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_linux_fullscreen_fallback(window: &WebviewWindow, monitor_rect: Rect) -> Result<()> {
    use gtk::prelude::*;

    tracing::warn!(
        "Wayland compositor does not support layer-shell; using monitor fullscreen fallback"
    );

    let gtk_window = window
        .gtk_window()
        .map_err(|e| anyhow!("failed to access GTK overlay window: {e}"))?;

    if let (Some(screen), Some((_monitor, index))) = (
        gtk::prelude::GtkWindowExt::screen(&gtk_window),
        gdk_monitor_for_capture_rect(&gtk_window, monitor_rect),
    ) {
        gtk_window.fullscreen_on_monitor(&screen, index);
    } else {
        gtk_window.fullscreen();
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn gdk_monitor_for_capture_rect(
    gtk_window: &gtk::ApplicationWindow,
    rect: Rect,
) -> Option<(gdk::Monitor, i32)> {
    use gtk::prelude::*;

    let display = gtk_window.display();
    gdk_monitor_for_display_rect(&display, rect)
}

#[cfg(target_os = "linux")]
fn gdk_monitor_for_display_rect(display: &gdk::Display, rect: Rect) -> Option<(gdk::Monitor, i32)> {
    use gdk::prelude::*;

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
const GTK_LAYER_SHELL_KEYBOARD_MODE_NONE: GtkLayerShellKeyboardMode = 0;
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
    use crate::types::Rect;

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
            !body.contains("activateIgnoringOtherApps:") && !body.contains("activateWithOptions:"),
            "activateIgnoringOtherApps brings existing settings/about/updater windows forward during capture",
        );
        assert!(
            !body.contains("makeKeyAndOrderFront:") && !body.contains("makeMainWindow"),
            "capture overlay fronting must not make the app key/main because that can reorder utility windows",
        );
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
            body.contains("linux_layer_shell()")
                && body.contains("configure_linux_layer_shell")
                && body.contains("GTK_LAYER_SHELL_LAYER_OVERLAY")
                && body.contains("set_anchor(gtk_ptr, edge, true)"),
            "Wayland overlays should use layer-shell before falling back to native fullscreen"
        );
    }

    #[test]
    fn wayland_scroll_region_frame_segments_stay_outside_selection() {
        let segments = super::scroll_region_frame_segments(
            Rect {
                x: 10,
                y: 20,
                width: 800,
                height: 600,
            },
            Rect {
                x: 100,
                y: 120,
                width: 240,
                height: 160,
            },
            2,
        );

        let tuples = segments
            .into_iter()
            .map(|r| (r.x, r.y, r.width, r.height))
            .collect::<Vec<_>>();

        assert_eq!(
            tuples,
            vec![
                (100, 118, 240, 2),
                (100, 280, 240, 2),
                (98, 120, 2, 160),
                (340, 120, 2, 160),
            ],
        );
    }

    #[test]
    fn wayland_scroll_region_frame_uses_one_click_through_surface_per_monitor() {
        let source = include_str!("overlay_window.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("overlay source should contain production section");

        assert!(production.contains("show_wayland_scroll_region_frame"));
        assert!(production.contains("gtk::WindowType::Popup"));
        assert!(production.contains("let Some(layer_shell) = linux_layer_shell() else"));
        assert!(production.contains("std::collections::HashMap<u32, gtk::Window>"));
        assert!(production.contains("set_default_size(monitor_rect.width as i32"));
        assert!(production.contains("scroll_region_frame_segments"));
        assert!(production.contains("set_pass_through(true)"));
        assert!(!production.contains("HashMap<u32, Vec<gtk::Window>>"));
        assert!(!production.contains("window.move_(monitor_rect.x, monitor_rect.y)"));
        assert!(!production.contains("set_margin(gtk_ptr, GTK_LAYER_SHELL_EDGE_LEFT, segment.x)"));
        assert!(!production.contains("set_margin(gtk_ptr, GTK_LAYER_SHELL_EDGE_TOP, segment.y)"));
        assert!(!production.contains("input_shape_combine_region"));
        assert!(!production.contains("ScrollOverlayFrame"));
        assert!(!production.contains("outside_selection_tiles"));
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
