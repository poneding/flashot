//! Windows-only fix for tray popup-menu icons rendering too small on scaled
//! (HiDPI) displays.
//!
//! `muda` (the menu backend behind Tauri's tray) draws each `IconMenuItem`
//! bitmap into a **hardcoded 16×16 pixel** target (`WinIcon::to_hbitmap` uses a
//! fixed `RECT { right: 16, bottom: 16 }` with `DrawIconEx`). Those are physical
//! pixels, so at 150% scaling the menu text is laid out at ~24 px while the icon
//! stays 16 px — visibly small and misaligned.
//!
//! We can't change muda without vendoring it, but Tauri exposes the native popup
//! `HMENU` via `Menu::hpopupmenu()`. After the menu is built we re-generate each
//! icon as a DPI-scaled 32-bit premultiplied-alpha DIB and overwrite the item's
//! `hbmpItem` with `SetMenuItemInfoW`. The menu then renders crisp icons that
//! track the system DPI the same way the menu font does.
//!
//! Icons are matched to menu items **by position**, so the caller passes one
//! [`MenuIconSlot`] per menu item in insertion order (separators included).

#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};

/// The source glyph for one menu position, or `None` for a separator / an item
/// without an icon. The RGBA buffer is the already-themed 36×36 icon produced by
/// `tray::lucide_menu_icon`.
pub struct MenuIconSlot {
    pub rgba: Option<Vec<u8>>,
    pub src_width: u32,
    pub src_height: u32,
}

impl MenuIconSlot {
    pub fn icon(rgba: Vec<u8>, width: u32, height: u32) -> Self {
        Self {
            rgba: Some(rgba),
            src_width: width,
            src_height: height,
        }
    }

    pub fn none() -> Self {
        Self {
            rgba: None,
            src_width: 0,
            src_height: 0,
        }
    }
}

/// Physical icon edge (px) for a given system DPI. Windows small icons are 16 px
/// at 96 DPI; we scale linearly so the glyph tracks the DPI-scaled menu font
/// instead of staying pinned at 16 physical px. Clamped so a bogus DPI can't ask
/// for an enormous bitmap. e.g. 96→16, 120→20, 144→24, 192→32.
#[cfg(any(target_os = "windows", test))]
fn target_icon_edge(dpi: u32) -> u32 {
    const BASE_ICON_LOGICAL: f64 = 16.0;
    let dpi = if dpi == 0 { 96 } else { dpi };
    ((BASE_ICON_LOGICAL * dpi as f64 / 96.0).round() as i32).clamp(16, 64) as u32
}

/// HBITMAPs we created and handed to the menu. muda never frees the bitmaps it
/// installs, and neither does Windows on `SetMenuItemInfoW` replacement, so we
/// track our own and delete the previous generation on each rebuild to avoid an
/// unbounded GDI-object leak across theme/hotkey menu rebuilds.
#[cfg(target_os = "windows")]
fn tracked_bitmaps() -> &'static Mutex<Vec<isize>> {
    static TRACKED: OnceLock<Mutex<Vec<isize>>> = OnceLock::new();
    TRACKED.get_or_init(|| Mutex::new(Vec::new()))
}

/// Overwrite each icon menu item's bitmap on `hpopupmenu` with a DPI-scaled DIB.
///
/// Must run on the main (UI) thread — the caller dispatches via
/// `run_on_main_thread`. `slots` must be in the same order as the items were
/// appended to the menu (separators represented by [`MenuIconSlot::none`]).
pub fn apply_dpi_scaled_icons(hpopupmenu: isize, slots: &[MenuIconSlot]) {
    #[cfg(target_os = "windows")]
    {
        apply_windows(hpopupmenu, slots);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (hpopupmenu, slots);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows(hpopupmenu: isize, slots: &[MenuIconSlot]) {
    use windows::Win32::Graphics::Gdi::{DeleteObject, HGDIOBJ};
    use windows::Win32::UI::HiDpi::GetDpiForSystem;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetMenuItemCount, SetMenuItemInfoW, HMENU, MENUITEMINFOW, MIIM_BITMAP,
    };

    if hpopupmenu == 0 {
        return;
    }
    let hmenu = HMENU(hpopupmenu as *mut _);

    // Free the bitmaps we installed on the previous rebuild before creating the
    // new generation.
    if let Ok(mut tracked) = tracked_bitmaps().lock() {
        for raw in tracked.drain(..) {
            // SAFETY: `raw` is an HBITMAP handle we created via CreateDIBSection
            // in a prior call and have not deleted yet.
            unsafe {
                let _ = DeleteObject(HGDIOBJ(raw as *mut _));
            }
        }
    }

    // SAFETY: GetDpiForSystem takes no arguments and cannot fail dangerously.
    let dpi = unsafe { GetDpiForSystem() };
    let target = target_icon_edge(dpi);

    // SAFETY: `hmenu` is the popup HMENU handed to us by muda via Tauri.
    let item_count = unsafe { GetMenuItemCount(Some(hmenu)) };
    if item_count < 0 {
        return;
    }
    let item_count = item_count as usize;

    let mut new_tracked: Vec<isize> = Vec::new();

    for (position, slot) in slots.iter().enumerate() {
        if position >= item_count {
            break;
        }
        let Some(src) = slot.rgba.as_ref() else {
            continue;
        };
        if slot.src_width == 0 || slot.src_height == 0 {
            continue;
        }
        let Some(hbitmap) = create_scaled_dib(src, slot.src_width, slot.src_height, target) else {
            continue;
        };

        let info = MENUITEMINFOW {
            cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
            fMask: MIIM_BITMAP,
            hbmpItem: hbitmap,
            ..Default::default()
        };
        // SAFETY: `hmenu` is valid and `info` is a fully-initialized
        // MENUITEMINFOW; fByPosition = TRUE matches items by menu index.
        let set_ok = unsafe { SetMenuItemInfoW(hmenu, position as u32, true, &info).is_ok() };
        if !set_ok {
            // Setting failed — free the bitmap we just made so it doesn't leak.
            // SAFETY: `hbitmap` was just created and not yet handed to the menu.
            unsafe {
                let _ = DeleteObject(HGDIOBJ(hbitmap.0));
            }
            continue;
        }
        new_tracked.push(hbitmap.0 as isize);
    }

    if let Ok(mut tracked) = tracked_bitmaps().lock() {
        *tracked = new_tracked;
    }
}

/// Resize the source RGBA glyph to `target`×`target` and build a top-down 32-bit
/// premultiplied-BGRA DIB section suitable for a menu `hbmpItem`. Returns the
/// created HBITMAP (owned by the caller) or `None` on failure.
#[cfg(target_os = "windows")]
fn create_scaled_dib(
    src_rgba: &[u8],
    src_w: u32,
    src_h: u32,
    target: u32,
) -> Option<windows::Win32::Graphics::Gdi::HBITMAP> {
    use image::{imageops, RgbaImage};
    use windows::Win32::Graphics::Gdi::{
        CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        HGDIOBJ,
    };

    if src_rgba.len() != (src_w as usize) * (src_h as usize) * 4 {
        return None;
    }

    let src_img: RgbaImage = RgbaImage::from_raw(src_w, src_h, src_rgba.to_vec())?;
    let scaled = imageops::resize(&src_img, target, target, imageops::FilterType::Lanczos3);

    let header = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: target as i32,
        // Negative height = top-down rows, matching image crate row order.
        biHeight: -(target as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let info = BITMAPINFO {
        bmiHeader: header,
        ..Default::default()
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    // SAFETY: `info` describes a valid 32-bit top-down DIB and `bits` receives
    // the pixel pointer. hdc/hsection are None (Windows uses a memory DC).
    let hbitmap =
        unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0) }.ok()?;
    if bits.is_null() {
        // SAFETY: `hbitmap` was just created and owns no other references.
        unsafe {
            let _ = DeleteObject(HGDIOBJ(hbitmap.0));
        }
        return None;
    }

    // Fill the DIB with premultiplied BGRA. Menus AlphaBlend 32-bit hbmpItem
    // bitmaps and expect premultiplied alpha, otherwise edges show a halo.
    let pixel_count = (target as usize) * (target as usize);
    // SAFETY: CreateDIBSection allocated exactly pixel_count*4 bytes at `bits`.
    let dst = unsafe { std::slice::from_raw_parts_mut(bits as *mut u8, pixel_count * 4) };
    for (i, px) in scaled.pixels().enumerate() {
        let [r, g, b, a] = px.0;
        let a16 = a as u16;
        let pr = ((r as u16 * a16) / 255) as u8;
        let pg = ((g as u16 * a16) / 255) as u8;
        let pb = ((b as u16 * a16) / 255) as u8;
        let o = i * 4;
        dst[o] = pb; // B
        dst[o + 1] = pg; // G
        dst[o + 2] = pr; // R
        dst[o + 3] = a; // A
    }

    Some(hbitmap)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_icon_edge_scales_linearly_with_dpi() {
        // 96 DPI (100%) -> 16, 120 (125%) -> 20, 144 (150%) -> 24, 192 (200%) -> 32.
        assert_eq!(target_icon_edge(96), 16);
        assert_eq!(target_icon_edge(120), 20);
        assert_eq!(target_icon_edge(144), 24);
        assert_eq!(target_icon_edge(192), 32);
    }

    #[test]
    fn target_icon_edge_treats_zero_dpi_as_baseline() {
        // GetDpiForSystem returns 0 on failure; fall back to the 96-DPI baseline.
        assert_eq!(target_icon_edge(0), 16);
    }

    #[test]
    fn target_icon_edge_clamps_absurd_dpi() {
        // A pathological DPI must not request an enormous bitmap.
        assert_eq!(target_icon_edge(10_000), 64);
    }

    #[test]
    fn menu_icon_slot_icon_carries_source_dimensions() {
        let slot = MenuIconSlot::icon(vec![0u8; 36 * 36 * 4], 36, 36);
        assert!(slot.rgba.is_some());
        assert_eq!((slot.src_width, slot.src_height), (36, 36));
    }

    #[test]
    fn menu_icon_slot_none_is_empty() {
        let slot = MenuIconSlot::none();
        assert!(slot.rgba.is_none());
        assert_eq!((slot.src_width, slot.src_height), (0, 0));
    }
}
