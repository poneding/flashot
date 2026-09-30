use crate::pin_geometry::{PinRect, pin_interaction_contains_point};
use tauri::WebviewWindow;

// NSRect is CGRect on the 64-bit macOS targets supported by Tauri. These four
// CGFloat fields have the same C layout as its nested CGPoint and CGSize.
#[repr(C)]
#[derive(Clone, Copy)]
struct NativeRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

unsafe impl objc::Encode for NativeRect {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGRect={CGPoint=dd}{CGSize=dd}}") }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct NativePoint {
    x: f64,
    y: f64,
}

unsafe impl objc::Encode for NativePoint {
    fn encode() -> objc::Encoding {
        unsafe { objc::Encoding::from_str("{CGPoint=dd}") }
    }
}

pub(super) fn interaction_contains_cursor(
    parent: &WebviewWindow,
    tools: &[WebviewWindow],
) -> Result<bool, String> {
    use objc::{
        Message,
        runtime::{Class, Object, Sel},
    };
    // Use AppKit screen points for both cursor and frames. Tauri's global
    // cursor uses the primary display's scale, which can differ from this pin.
    let bounds = |window: &WebviewWindow| -> Result<PinRect, String> {
        let native = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
        let frame: NativeRect = unsafe { (*native).send_message(Sel::register("frame"), ()) }
            .map_err(|e| e.to_string())?;
        Ok(PinRect {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
        })
    };
    let event = Class::get("NSEvent").ok_or("NSEvent unavailable")?;
    let cursor: NativePoint = unsafe { event.send_message(Sel::register("mouseLocation"), ()) }
        .map_err(|e| e.to_string())?;
    let image = bounds(parent)?;
    let tools = tools.iter().map(bounds).collect::<Result<Vec<_>, _>>()?;
    Ok(pin_interaction_contains_point(
        image, &tools, cursor.x, cursor.y, 1.0,
    ))
}

/// Apply the complete frame before revealing/attaching the palette. Tao's
/// set_size/set_position enqueue another main-queue operation even when already
/// on the main thread, which would leave the cached frame ahead of the window.
pub(super) fn set_tool_frame(
    parent: &WebviewWindow,
    window: &WebviewWindow,
    pin: PinRect,
    rect: PinRect,
    dpi: f64,
) -> Result<(), String> {
    use objc::{
        Message,
        runtime::{NO, Object, Sel, YES},
    };
    let parent = parent.ns_window().map_err(|e| e.to_string())? as *mut Object;
    let child = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    unsafe {
        let owner: NativeRect = (*parent)
            .send_message(Sel::register("frame"), ())
            .map_err(|e| e.to_string())?;
        let frame = NativeRect {
            x: owner.x + (rect.x - pin.x) / dpi,
            y: owner.y + owner.height - (rect.y - pin.y + rect.height) / dpi,
            width: rect.width / dpi,
            height: rect.height / dpi,
        };
        (*child)
            .send_message::<_, ()>(Sel::register("setFrame:display:animate:"), (frame, YES, NO))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn show_tool_window(
    parent: &WebviewWindow,
    window: &WebviewWindow,
) -> Result<(), String> {
    use objc::{
        Message,
        runtime::{Object, Sel},
    };
    let parent = parent.ns_window().map_err(|e| e.to_string())? as *mut Object;
    let child = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    // Called on the main thread. Reattach on every reveal, including after a
    // hover hide. AppKit then moves the whole window group in its drag loop.
    unsafe {
        let previous: *mut Object = (*child)
            .send_message(Sel::register("parentWindow"), ())
            .map_err(|e| e.to_string())?;
        if previous != parent {
            if !previous.is_null() {
                (*previous)
                    .send_message::<_, ()>(Sel::register("removeChildWindow:"), (child,))
                    .map_err(|e| e.to_string())?;
            }
            (*parent)
                .send_message::<_, ()>(Sel::register("addChildWindow:ordered:"), (child, 1isize))
                .map_err(|e| e.to_string())?;
        }
        // Tauri's show() makes the window key. Hover tools must not steal the
        // image's focus or cancel a mouse press that is about to start a drag.
        (*child)
            .send_message::<_, ()>(
                Sel::register("orderFront:"),
                (std::ptr::null_mut::<Object>(),),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(super) fn hide_tool_window(window: &WebviewWindow) -> Result<(), String> {
    use objc::{
        Message,
        runtime::{Object, Sel},
    };
    let child = window.ns_window().map_err(|e| e.to_string())? as *mut Object;
    unsafe {
        let parent: *mut Object = (*child)
            .send_message(Sel::register("parentWindow"), ())
            .map_err(|e| e.to_string())?;
        if !parent.is_null() {
            (*parent)
                .send_message::<_, ()>(Sel::register("removeChildWindow:"), (child,))
                .map_err(|e| e.to_string())?;
        }
    }
    window.hide().map_err(|e| e.to_string())
}
