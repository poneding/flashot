use anyhow::Result;
use tauri::WebviewWindow;

pub fn configure_capture_overlay(window: &WebviewWindow) -> Result<()> {
    configure_platform_overlay(window)
}

pub fn bring_capture_overlay_to_front(window: &WebviewWindow) -> Result<()> {
    bring_platform_overlay_to_front(window)
}

pub fn capture_overlay_accepts_first_mouse() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn overlay_level_from_shielding_level(shielding_level: isize) -> isize {
    shielding_level + 1
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
}

#[cfg(target_os = "macos")]
fn configure_platform_overlay(window: &WebviewWindow) -> Result<()> {
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

#[cfg(not(target_os = "macos"))]
fn configure_platform_overlay(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn bring_platform_overlay_to_front(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}
