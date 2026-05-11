use anyhow::{anyhow, Result};
use std::sync::{mpsc, Mutex};
use tauri::{AppHandle, WebviewWindow};

static SAVED_PRESENTATION_OPTIONS: Mutex<Option<usize>> = Mutex::new(None);

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

pub fn enter_capture_presentation(app: &AppHandle) -> Result<()> {
    run_on_app_main_thread(app, "enter capture presentation", || {
        enter_platform_capture_presentation()
    })
}

pub fn restore_capture_presentation(app: &AppHandle) -> Result<()> {
    run_on_app_main_thread(app, "restore capture presentation", || {
        restore_platform_capture_presentation()
    })
}

pub fn capture_overlay_accepts_first_mouse() -> bool {
    true
}

#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK: usize = 1 << 0;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_HIDE_DOCK: usize = 1 << 1;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR: usize = 1 << 2;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_HIDE_MENU_BAR: usize = 1 << 3;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_DISABLE_APPLE_MENU: usize = 1 << 4;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_DISABLE_PROCESS_SWITCHING: usize = 1 << 5;
#[cfg(target_os = "macos")]
const NS_APPLICATION_PRESENTATION_DISABLE_HIDE_APPLICATION: usize = 1 << 8;

#[cfg(target_os = "macos")]
fn overlay_level_from_shielding_level(shielding_level: isize) -> isize {
    shielding_level + 1
}

#[cfg(target_os = "macos")]
fn capture_presentation_options(current: usize) -> usize {
    let visibility_mask = NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK
        | NS_APPLICATION_PRESENTATION_HIDE_DOCK
        | NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR
        | NS_APPLICATION_PRESENTATION_HIDE_MENU_BAR;

    (current & !visibility_mask)
        | NS_APPLICATION_PRESENTATION_DISABLE_APPLE_MENU
        | NS_APPLICATION_PRESENTATION_DISABLE_PROCESS_SWITCHING
        | NS_APPLICATION_PRESENTATION_DISABLE_HIDE_APPLICATION
}

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
    fn macos_overlay_sits_above_shielding_level() {
        assert_eq!(super::overlay_level_from_shielding_level(2000), 2001);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn capture_presentation_keeps_dock_and_menu_bar_visible() {
        let preserved_option = 1 << 12;
        let existing = super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK
            | super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR
            | preserved_option;

        let options = super::capture_presentation_options(existing);

        assert_eq!(options & super::NS_APPLICATION_PRESENTATION_HIDE_DOCK, 0);
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_HIDE_MENU_BAR,
            0
        );
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_DOCK,
            0
        );
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_AUTO_HIDE_MENU_BAR,
            0
        );
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_DISABLE_APPLE_MENU,
            super::NS_APPLICATION_PRESENTATION_DISABLE_APPLE_MENU
        );
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_DISABLE_PROCESS_SWITCHING,
            super::NS_APPLICATION_PRESENTATION_DISABLE_PROCESS_SWITCHING
        );
        assert_eq!(
            options & super::NS_APPLICATION_PRESENTATION_DISABLE_HIDE_APPLICATION,
            super::NS_APPLICATION_PRESENTATION_DISABLE_HIDE_APPLICATION
        );
        assert_eq!(options & preserved_option, preserved_option);
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
    }

    overlay_level_from_shielding_level(unsafe { CGShieldingWindowLevel() } as isize)
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

#[cfg(target_os = "macos")]
fn enter_platform_capture_presentation() -> Result<()> {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    let app_class =
        Class::get("NSApplication").ok_or_else(|| anyhow!("NSApplication class not found"))?;

    unsafe {
        let ns_app: *mut Object = app_class.send_message(Sel::register("sharedApplication"), ())?;
        let current: usize = (*ns_app).send_message(Sel::register("presentationOptions"), ())?;
        {
            let mut saved = SAVED_PRESENTATION_OPTIONS
                .lock()
                .expect("presentation option lock poisoned");
            if saved.is_none() {
                *saved = Some(current);
            }
        }
        (*ns_app).send_message::<_, ()>(
            Sel::register("setPresentationOptions:"),
            (capture_presentation_options(current),),
        )?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_platform_capture_presentation() -> Result<()> {
    use objc::{
        runtime::{Class, Object, Sel},
        Message,
    };

    let Some(previous) = SAVED_PRESENTATION_OPTIONS
        .lock()
        .expect("presentation option lock poisoned")
        .take()
    else {
        return Ok(());
    };

    let app_class =
        Class::get("NSApplication").ok_or_else(|| anyhow!("NSApplication class not found"))?;

    unsafe {
        let ns_app: *mut Object = app_class.send_message(Sel::register("sharedApplication"), ())?;
        (*ns_app).send_message::<_, ()>(Sel::register("setPresentationOptions:"), (previous,))?;
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_overlay(_window: &WebviewWindow, _monitor_id: u32) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn enter_platform_capture_presentation() -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn restore_platform_capture_presentation() -> Result<()> {
    Ok(())
}
