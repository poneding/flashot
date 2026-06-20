use crate::types::{Rect, WindowRect};
use anyhow::Result;
use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, CGWindowListOption,
};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(option: CGWindowListOption, relativeToWindow: u32) -> CFArrayRef;
}

pub fn enumerate() -> Result<Vec<WindowRect>> {
    tracing::info!("window_probe::enumerate: starting");
    let list_opt = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let arr_ref: CFArrayRef = unsafe { CGWindowListCopyWindowInfo(list_opt, 0) };

    if arr_ref.is_null() {
        tracing::error!("window_probe::enumerate: CGWindowListCopyWindowInfo returned NULL");
        anyhow::bail!("CGWindowListCopyWindowInfo returned NULL");
    }

    let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(arr_ref) };
    tracing::info!("window_probe::enumerate: got {} window entries", arr.len());

    let mut out = Vec::new();
    for i in 0..arr.len() {
        let dict_ref = match arr.get(i) {
            Some(d) => d,
            None => continue,
        };
        let dict: CFDictionary = match dict_ref.downcast::<CFDictionary>() {
            Some(d) => d,
            None => continue,
        };

        if let Some(window) = window_rect_from_dict(&dict) {
            out.push(window);
        }
    }
    // CGWindowList already returns in front-to-back z-order.
    tracing::info!("window_probe::enumerate: returning {} windows", out.len());
    Ok(out)
}

pub fn active_window() -> Result<WindowRect> {
    enumerate()?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("no visible normal window found"))
}

fn window_rect_from_dict(dict: &CFDictionary) -> Option<WindowRect> {
    let rect = read_bounds(dict)?;
    let title = read_string(dict, "kCGWindowName").unwrap_or_default();
    let app_name = read_string(dict, "kCGWindowOwnerName").unwrap_or_default();
    let pid = read_u32(dict, "kCGWindowOwnerPID").unwrap_or(0);
    let layer = read_i64(dict, "kCGWindowLayer").unwrap_or(NORMAL_WINDOW_LEVEL);

    // App content can legitimately live above the normal level: NSPanel-style
    // utility windows, modal alerts/sheets, and pop-up/dropdown windows are all
    // user-visible targets that should freeze and snap-select during capture.
    // Keep the whitelist narrow so system chrome (Dock, menu bar, cursor,
    // assistive overlays, Flashot pin windows at FLOATING+3, ...) stays out of
    // window detection.
    if !is_detectable_window_layer(layer)
        || rect.width <= 1
        || rect.height <= 1
        || app_name.is_empty()
    {
        return None;
    }

    Some(WindowRect {
        rect,
        title,
        app_name,
        pid,
    })
}

fn read_bounds(dict: &CFDictionary) -> Option<Rect> {
    let bounds = read_cf_value(dict, "kCGWindowBounds")?.downcast::<CFDictionary>()?;
    let x = read_f64(&bounds, "X")? as i32;
    let y = read_f64(&bounds, "Y")? as i32;
    let w = read_f64(&bounds, "Width")? as u32;
    let h = read_f64(&bounds, "Height")? as u32;
    Some(Rect {
        x,
        y,
        width: w,
        height: h,
    })
}

const NORMAL_WINDOW_LEVEL: i64 = 0;
const FLOATING_WINDOW_LEVEL: i64 = 3;
const MODAL_PANEL_WINDOW_LEVEL: i64 = 8;
const POP_UP_MENU_WINDOW_LEVEL: i64 = 101;

fn is_detectable_window_layer(layer: i64) -> bool {
    matches!(
        layer,
        NORMAL_WINDOW_LEVEL
            | FLOATING_WINDOW_LEVEL
            | MODAL_PANEL_WINDOW_LEVEL
            | POP_UP_MENU_WINDOW_LEVEL
    )
}

fn read_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let s = read_cf_value(dict, key)?.downcast::<CFString>()?;
    Some(s.to_string())
}

fn read_u32(dict: &CFDictionary, key: &str) -> Option<u32> {
    let n = read_cf_value(dict, key)?.downcast::<CFNumber>()?;
    n.to_i64().map(|x| x as u32)
}

fn read_i64(dict: &CFDictionary, key: &str) -> Option<i64> {
    let n = read_cf_value(dict, key)?.downcast::<CFNumber>()?;
    n.to_i64()
}

fn read_f64(dict: &CFDictionary, key: &str) -> Option<f64> {
    let n = read_cf_value(dict, key)?.downcast::<CFNumber>()?;
    n.to_f64()
}

fn read_cf_value(dict: &CFDictionary, key: &str) -> Option<CFType> {
    let key = CFString::new(key);
    let value = dict.find(key.as_CFTypeRef())?;
    Some(unsafe { CFType::wrap_under_get_rule(*value) })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct WindowDictInput<'a> {
        title: Option<&'a str>,
        app_name: &'a str,
        pid: i32,
        layer: i32,
        bounds: (f64, f64, f64, f64),
    }

    fn window_dict(input: WindowDictInput<'_>) -> CFDictionary {
        let owner_key = CFString::new("kCGWindowOwnerName");
        let owner = CFString::new(input.app_name);
        let pid_key = CFString::new("kCGWindowOwnerPID");
        let pid = CFNumber::from(input.pid);
        let layer_key = CFString::new("kCGWindowLayer");
        let layer = CFNumber::from(input.layer);
        let (x, y, width, height) = input.bounds;

        let x_key = CFString::new("X");
        let x = CFNumber::from(x);
        let y_key = CFString::new("Y");
        let y = CFNumber::from(y);
        let width_key = CFString::new("Width");
        let width = CFNumber::from(width);
        let height_key = CFString::new("Height");
        let height = CFNumber::from(height);
        let bounds = CFDictionary::from_CFType_pairs(&[
            (x_key.as_CFType(), x.as_CFType()),
            (y_key.as_CFType(), y.as_CFType()),
            (width_key.as_CFType(), width.as_CFType()),
            (height_key.as_CFType(), height.as_CFType()),
        ]);
        let bounds_key = CFString::new("kCGWindowBounds");

        let mut pairs = vec![
            (owner_key.as_CFType(), owner.as_CFType()),
            (pid_key.as_CFType(), pid.as_CFType()),
            (layer_key.as_CFType(), layer.as_CFType()),
            (bounds_key.as_CFType(), bounds.as_CFType()),
        ];

        let title_key;
        let title_value;
        if let Some(title) = input.title {
            title_key = CFString::new("kCGWindowName");
            title_value = CFString::new(title);
            pairs.push((title_key.as_CFType(), title_value.as_CFType()));
        }

        CFDictionary::from_CFType_pairs(&pairs).to_untyped()
    }

    #[test]
    fn reads_untyped_core_graphics_dictionary_values() {
        let dict = window_dict(WindowDictInput {
            title: None,
            app_name: "Finder",
            pid: 1234,
            layer: 0,
            bounds: (10.0, 20.0, 300.0, 200.0),
        });

        assert_eq!(
            read_string(&dict, "kCGWindowOwnerName").as_deref(),
            Some("Finder")
        );
        assert_eq!(read_u32(&dict, "kCGWindowOwnerPID"), Some(1234));
        assert_eq!(read_i64(&dict, "kCGWindowLayer"), Some(0));

        let rect = read_bounds(&dict).expect("bounds should decode");
        assert_eq!(
            (rect.x, rect.y, rect.width, rect.height),
            (10, 20, 300, 200)
        );
    }

    #[test]
    fn parses_normal_windows_even_when_title_is_missing() {
        let dict = window_dict(WindowDictInput {
            title: None,
            app_name: "Code",
            pid: 4321,
            layer: 0,
            bounds: (-100.0, 40.0, 900.0, 700.0),
        });

        let window = window_rect_from_dict(&dict).expect("untitled app window should be detected");

        assert_eq!(window.app_name, "Code");
        assert_eq!(window.title, "");
        assert_eq!(window.pid, 4321);
        assert_eq!(
            (
                window.rect.x,
                window.rect.y,
                window.rect.width,
                window.rect.height
            ),
            (-100, 40, 900, 700)
        );
    }

    #[test]
    fn rejects_system_chrome_layers() {
        let dict = window_dict(WindowDictInput {
            title: Some("Dock"),
            app_name: "Dock",
            pid: 99,
            layer: 20,
            bounds: (0.0, 0.0, 800.0, 40.0),
        });

        assert!(window_rect_from_dict(&dict).is_none());
    }

    #[test]
    fn includes_flashots_own_floating_utility_windows() {
        // Settings/About/Updater are pinned to the floating level so they stay
        // on top during capture; the probe must still detect them so the user
        // can snap-select them.
        let dict = window_dict(WindowDictInput {
            title: Some("Settings"),
            app_name: "Flashot",
            pid: std::process::id() as i32,
            layer: crate::app_activation::FLOATING_WINDOW_LEVEL as i32,
            bounds: (120.0, 80.0, 560.0, 560.0),
        });

        let window = window_rect_from_dict(&dict).expect("own floating utility window is detected");
        assert_eq!(window.app_name, "Flashot");
        assert_eq!(window.pid, std::process::id());
    }

    #[test]
    fn includes_other_apps_floating_panels() {
        let dict = window_dict(WindowDictInput {
            title: Some("Panel"),
            app_name: "OtherApp",
            pid: 5555,
            layer: FLOATING_WINDOW_LEVEL as i32,
            bounds: (120.0, 80.0, 300.0, 200.0),
        });

        let window = window_rect_from_dict(&dict).expect("floating panels are detected");
        assert_eq!(window.app_name, "OtherApp");
    }

    #[test]
    fn includes_macos_modal_panel_windows() {
        let dict = window_dict(WindowDictInput {
            title: Some("Alert"),
            app_name: "OtherApp",
            pid: 5555,
            layer: MODAL_PANEL_WINDOW_LEVEL as i32,
            bounds: (120.0, 80.0, 300.0, 200.0),
        });

        let window = window_rect_from_dict(&dict).expect("modal panels are detected");
        assert_eq!(window.title, "Alert");
    }

    #[test]
    fn includes_macos_pop_up_windows() {
        let dict = window_dict(WindowDictInput {
            title: Some("Menu"),
            app_name: "OtherApp",
            pid: 5555,
            layer: POP_UP_MENU_WINDOW_LEVEL as i32,
            bounds: (120.0, 80.0, 300.0, 200.0),
        });

        let window = window_rect_from_dict(&dict).expect("pop-up windows are detected");
        assert_eq!(window.title, "Menu");
    }

    #[test]
    fn rejects_flashot_pin_window_level() {
        let dict = window_dict(WindowDictInput {
            title: Some("Pin"),
            app_name: "Flashot",
            pid: std::process::id() as i32,
            layer: (crate::app_activation::FLOATING_WINDOW_LEVEL + 3) as i32,
            bounds: (120.0, 80.0, 300.0, 200.0),
        });

        assert!(window_rect_from_dict(&dict).is_none());
    }
}
