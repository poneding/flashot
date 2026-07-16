use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{Context, Result, anyhow};
use core_graphics::display::CGDisplay;
use xcap::Monitor;

pub fn enumerate_monitors() -> Result<Vec<MonitorInfo>> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    monitors.iter().map(monitor_info).collect()
}

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    tracing::info!("capture_all_monitors: starting");
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    tracing::info!("capture_all_monitors: found {} monitors", monitors.len());
    let mut infos = Vec::new();
    let mut frames = Vec::new();

    for mon in monitors.iter() {
        let info = monitor_info(mon)?;
        tracing::info!("capture_all_monitors: processing monitor {}", info.id);
        tracing::info!(
            "capture_all_monitors: monitor {} - {}x{} at ({}, {}), scale {}",
            info.id,
            info.rect.width,
            info.rect.height,
            info.rect.x,
            info.rect.y,
            info.scale_factor
        );

        tracing::info!("capture_all_monitors: capturing monitor {}", info.id);
        let (rgba, frame_width, frame_height) = capture_display_without_cursor(info.id)?;
        tracing::info!(
            "capture_all_monitors: captured {} bytes for monitor {} ({}x{} physical)",
            rgba.len(),
            info.id,
            frame_width,
            frame_height
        );
        frames.push(FrozenFrame {
            monitor_id: info.id,
            rgba,
            width: frame_width,
            height: frame_height,
            scale_factor: info.scale_factor,
            icc_profile: display_icc_profile(info.id),
        });
        infos.push(info);
    }

    tracing::info!("capture_all_monitors: completed successfully");
    Ok((infos, frames))
}

fn capture_display_without_cursor(display_id: u32) -> Result<(Vec<u8>, u32, u32)> {
    // CGDisplayCreateImage samples the display framebuffer directly. Unlike
    // the window-list compositor used by xcap on macOS, it does not composite
    // the hardware cursor into the returned image, so the live cursor can stay
    // visible until the frozen overlay replaces it with a crosshair.
    let image = CGDisplay::new(display_id)
        .image()
        .ok_or_else(|| anyhow!("Failed to capture display {display_id}"))?;
    if image.bits_per_pixel() != 32 {
        return Err(anyhow!(
            "Unsupported display pixel format: {} bits per pixel",
            image.bits_per_pixel()
        ));
    }

    let width = image.width();
    let height = image.height();
    let bytes_per_row = image.bytes_per_row();
    let data = image.data();
    let source = data.bytes();
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in source.chunks_exact(bytes_per_row).take(height) {
        rgba.extend_from_slice(&row[..width * 4]);
    }
    for bgra in rgba.chunks_exact_mut(4) {
        bgra.swap(0, 2);
    }

    Ok((rgba, width as u32, height as u32))
}

fn monitor_info(mon: &Monitor) -> Result<MonitorInfo> {
    let id = mon.id().context("Failed to get monitor id")?;
    let scale = mon.scale_factor().context("Failed to get scale factor")?;
    let x = mon.x().context("Failed to get x coordinate")?;
    let y = mon.y().context("Failed to get y coordinate")?;
    let w = mon.width().context("Failed to get width")?;
    let h = mon.height().context("Failed to get height")?;

    Ok(monitor_info_from_parts(id, x, y, w, h, scale))
}

fn monitor_info_from_parts(
    id: u32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f32,
) -> MonitorInfo {
    MonitorInfo {
        id,
        rect: Rect {
            x,
            y,
            width,
            height,
        },
        scale_factor,
    }
}

fn display_icc_profile(display_id: u32) -> Option<Vec<u8>> {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::data::{CFData, CFDataRef};
    use core_graphics::display::CGDirectDisplayID;
    use core_graphics::sys::CGColorSpaceRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGDisplayCopyColorSpace(display: CGDirectDisplayID) -> CGColorSpaceRef;
        fn CGColorSpaceCopyICCData(space: CGColorSpaceRef) -> CFDataRef;
    }

    unsafe {
        let color_space = CGDisplayCopyColorSpace(display_id);
        if color_space.is_null() {
            return None;
        }

        let icc_data = CGColorSpaceCopyICCData(color_space);
        CFRelease(color_space as CFTypeRef);
        if icc_data.is_null() {
            return None;
        }

        let data = CFData::wrap_under_create_rule(icc_data);
        Some(data.bytes().to_vec()).filter(|profile| !profile.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::monitor_info_from_parts;

    #[test]
    fn monitor_info_uses_native_display_id_instead_of_enumeration_index() {
        let info = monitor_info_from_parts(42, -1800, 0, 1800, 1169, 2.0);

        assert_eq!(info.id, 42);
        assert_eq!(
            (info.rect.x, info.rect.y, info.rect.width, info.rect.height),
            (-1800, 0, 1800, 1169)
        );
        assert_eq!(info.scale_factor, 2.0);
    }

    #[test]
    fn display_capture_avoids_the_window_list_cursor_compositor() {
        let source = include_str!("macos.rs");
        let capture_start = source.find("pub fn capture_all_monitors").unwrap();
        let capture_body = &source[capture_start..source.find("fn monitor_info").unwrap()];

        assert!(capture_body.contains("capture_display_without_cursor"));
        assert!(source.contains("CGDisplay::new(display_id)"));
        assert!(!capture_body.contains("mon.capture_image()"));
        assert!(!capture_body.contains("CGDisplayHideCursor"));
    }
}
