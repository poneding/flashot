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
    fn CGWindowListCopyWindowInfo(option: CGWindowListOption, relativeToWindow: u32)
        -> CFArrayRef;
}

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let list_opt = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let arr_ref: CFArrayRef = unsafe { CGWindowListCopyWindowInfo(list_opt, 0) };
    let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(arr_ref) };

    let mut out = Vec::new();
    for i in 0..arr.len() {
        let dict_ref = arr.get(i).unwrap();
        let dict: CFDictionary = match dict_ref.downcast::<CFDictionary>() {
            Some(d) => d,
            None => continue,
        };

        let rect = read_bounds(&dict);
        let title = read_string(&dict, "kCGWindowName").unwrap_or_default();
        let app_name = read_string(&dict, "kCGWindowOwnerName").unwrap_or_default();
        let pid = read_u32(&dict, "kCGWindowOwnerPID").unwrap_or(0);
        let layer = read_u32(&dict, "kCGWindowLayer").unwrap_or(0);

        // Skip non-normal layers (Dock/menubar)
        if layer != 0 {
            continue;
        }
        // Skip windows with empty rect or no app
        if let Some(rect) = rect {
            if rect.width > 1 && rect.height > 1 && !app_name.is_empty() {
                out.push(WindowRect { rect, title, app_name, pid });
            }
        }
    }
    // CGWindowList already returns in front-to-back z-order.
    Ok(out)
}

fn read_bounds(dict: &CFDictionary) -> Option<Rect> {
    let key = CFString::new("kCGWindowBounds");
    let val = dict.find(&key as *const _ as *const _)?;
    // CGWindowBounds is itself a CFDictionary
    let bounds: CFDictionary =
        unsafe { CFDictionary::wrap_under_get_rule(*val as *const _) };
    let x = read_f64(&bounds, "X")? as i32;
    let y = read_f64(&bounds, "Y")? as i32;
    let w = read_f64(&bounds, "Width")? as u32;
    let h = read_f64(&bounds, "Height")? as u32;
    Some(Rect { x, y, width: w, height: h })
}

fn read_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let k = CFString::new(key);
    let v = dict.find(&k as *const _ as *const _)?;
    let s: CFString = unsafe { CFString::wrap_under_get_rule(*v as *const _) };
    Some(s.to_string())
}

fn read_u32(dict: &CFDictionary, key: &str) -> Option<u32> {
    let k = CFString::new(key);
    let v = dict.find(&k as *const _ as *const _)?;
    let n: CFNumber = unsafe { CFNumber::wrap_under_get_rule(*v as *const _) };
    n.to_i64().map(|x| x as u32)
}

fn read_f64(dict: &CFDictionary, key: &str) -> Option<f64> {
    let k = CFString::new(key);
    let v = dict.find(&k as *const _ as *const _)?;
    let n: CFNumber = unsafe { CFNumber::wrap_under_get_rule(*v as *const _) };
    n.to_f64()
}
