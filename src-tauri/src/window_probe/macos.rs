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
extern "C" {
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

fn window_rect_from_dict(dict: &CFDictionary) -> Option<WindowRect> {
    let rect = read_bounds(dict)?;
    let title = read_string(dict, "kCGWindowName").unwrap_or_default();
    let app_name = read_string(dict, "kCGWindowOwnerName").unwrap_or_default();
    let pid = read_u32(dict, "kCGWindowOwnerPID").unwrap_or(0);
    let layer = read_u32(dict, "kCGWindowLayer").unwrap_or(0);

    if layer != 0 || rect.width <= 1 || rect.height <= 1 || app_name.is_empty() {
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

fn read_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let s = read_cf_value(dict, key)?.downcast::<CFString>()?;
    Some(s.to_string())
}

fn read_u32(dict: &CFDictionary, key: &str) -> Option<u32> {
    let n = read_cf_value(dict, key)?.downcast::<CFNumber>()?;
    n.to_i64().map(|x| x as u32)
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

    fn window_dict(
        title: Option<&str>,
        app_name: &str,
        pid: i32,
        layer: i32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> CFDictionary {
        let owner_key = CFString::new("kCGWindowOwnerName");
        let owner = CFString::new(app_name);
        let pid_key = CFString::new("kCGWindowOwnerPID");
        let pid = CFNumber::from(pid);
        let layer_key = CFString::new("kCGWindowLayer");
        let layer = CFNumber::from(layer);

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
        if let Some(title) = title {
            title_key = CFString::new("kCGWindowName");
            title_value = CFString::new(title);
            pairs.push((title_key.as_CFType(), title_value.as_CFType()));
        }

        CFDictionary::from_CFType_pairs(&pairs).to_untyped()
    }

    #[test]
    fn reads_untyped_core_graphics_dictionary_values() {
        let dict = window_dict(None, "Finder", 1234, 0, 10.0, 20.0, 300.0, 200.0);

        assert_eq!(
            read_string(&dict, "kCGWindowOwnerName").as_deref(),
            Some("Finder")
        );
        assert_eq!(read_u32(&dict, "kCGWindowOwnerPID"), Some(1234));
        assert_eq!(read_u32(&dict, "kCGWindowLayer"), Some(0));

        let rect = read_bounds(&dict).expect("bounds should decode");
        assert_eq!(
            (rect.x, rect.y, rect.width, rect.height),
            (10, 20, 300, 200)
        );
    }

    #[test]
    fn parses_normal_windows_even_when_title_is_missing() {
        let dict = window_dict(None, "Code", 4321, 0, -100.0, 40.0, 900.0, 700.0);

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
    fn rejects_non_normal_layers() {
        let dict = window_dict(Some("Dock"), "Dock", 99, 20, 0.0, 0.0, 800.0, 40.0);

        assert!(window_rect_from_dict(&dict).is_none());
    }
}
