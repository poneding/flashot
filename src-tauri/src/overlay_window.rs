use anyhow::Result;
use tauri::WebviewWindow;

pub fn configure_capture_overlay(window: &WebviewWindow) -> Result<()> {
    configure_platform_overlay(window)
}

#[cfg(target_os = "macos")]
fn configure_platform_overlay(window: &WebviewWindow) -> Result<()> {
    use objc::{
        runtime::{Object, Sel, NO},
        Message,
    };

    const NS_SCREEN_SAVER_WINDOW_LEVEL: isize = 1000;
    const NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY: usize = 1 << 4;
    const NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;

    let ns_window = window.ns_window()? as *mut Object;
    let behavior = NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
        | NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY
        | NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY;

    unsafe {
        let ns_window = &*ns_window;
        ns_window
            .send_message::<_, ()>(Sel::register("setLevel:"), (NS_SCREEN_SAVER_WINDOW_LEVEL,))?;
        ns_window.send_message::<_, ()>(Sel::register("setCollectionBehavior:"), (behavior,))?;
        ns_window.send_message::<_, ()>(Sel::register("setHasShadow:"), (NO,))?;
        ns_window.send_message::<_, ()>(Sel::register("setOpaque:"), (NO,))?;
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_overlay(_window: &WebviewWindow) -> Result<()> {
    Ok(())
}
