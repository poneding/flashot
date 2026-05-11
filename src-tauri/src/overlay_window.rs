use anyhow::{anyhow, Result};
use std::sync::mpsc;
use tauri::WebviewWindow;

pub fn configure_capture_overlay(window: &WebviewWindow, monitor_id: u32) -> Result<()> {
    run_on_window_main_thread(window, "configure capture overlay", move |window| {
        configure_platform_overlay(window, monitor_id)
    })
}

pub fn bring_capture_overlay_to_front(window: &WebviewWindow) -> Result<()> {
    run_on_window_main_thread(window, "bring capture overlay to front", |window| {
        bring_platform_overlay_to_front(window)
    })
}

pub fn capture_overlay_accepts_first_mouse() -> bool {
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

#[cfg(test)]
mod tests {
    #[test]
    fn capture_overlay_accepts_first_mouse_clicks() {
        assert!(super::capture_overlay_accepts_first_mouse());
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
}

#[cfg(target_os = "macos")]
fn configure_platform_overlay(window: &WebviewWindow, monitor_id: u32) -> Result<()> {
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
fn bring_platform_overlay_to_front(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel},
        Message,
    };

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let ns_window = &*ns_window;
        ns_window.send_message::<_, ()>(Sel::register("orderFrontRegardless"), ())?;
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

#[cfg(not(target_os = "macos"))]
fn configure_platform_overlay(_window: &WebviewWindow, _monitor_id: u32) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}
