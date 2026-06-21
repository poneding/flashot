#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{capture_all_monitors, enumerate_monitors};

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::{capture_all_monitors, enumerate_monitors};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::{capture_all_monitors, capture_monitor_region, enumerate_monitors};

mod portal_uri;

use anyhow::{Context, Result, bail};

#[cfg(not(target_os = "linux"))]
pub fn capture_monitor_region(
    monitor_id: u32,
    rect_physical: crate::types::Rect,
) -> Result<Vec<u8>> {
    capture_xcap_monitor_region(monitor_id, rect_physical)
}

/// Capture a single xcap monitor and crop to the given physical-pixel rect.
/// Used by scroll capture loop — returns just the selection bytes, no disk I/O.
pub(crate) fn capture_xcap_monitor_region(
    monitor_id: u32,
    rect_physical: crate::types::Rect,
) -> Result<Vec<u8>> {
    debug_assert!(
        rect_physical.x >= 0 && rect_physical.y >= 0,
        "physical rect must be non-negative"
    );

    let monitors = xcap::Monitor::all().context("Failed to enumerate monitors")?;
    let mon = monitors
        .into_iter()
        .find(|m| m.id().unwrap_or(0) == monitor_id)
        .ok_or_else(|| anyhow::anyhow!("monitor {monitor_id} not found"))?;
    let img = mon.capture_image().context("Failed to capture monitor")?;
    let img_width = img.width();
    let img_height = img.height();
    let rgba = img.into_raw();

    crop_physical_rect_from_rgba(&rgba, img_width, img_height, rect_physical)
}

pub(crate) fn crop_physical_rect_from_rgba(
    rgba: &[u8],
    img_width: u32,
    img_height: u32,
    rect_physical: crate::types::Rect,
) -> Result<Vec<u8>> {
    let rect_physical = clamp_capture_rect_to_image(rect_physical, img_width, img_height)?;
    let rect_x = rect_physical.x as u32;
    let rect_y = rect_physical.y as u32;
    let row_bytes = (rect_physical.width as usize) * 4;
    let mut out = Vec::with_capacity(row_bytes * rect_physical.height as usize);
    for row in 0..rect_physical.height {
        let y = rect_y + row;
        let start = (y * img_width + rect_x) as usize * 4;
        let end = start + row_bytes;
        let slice = rgba
            .get(start..end)
            .with_context(|| format!("capture rect row {row} is out of bounds"))?;
        out.extend_from_slice(slice);
    }
    Ok(out)
}

fn clamp_capture_rect_to_image(
    rect: crate::types::Rect,
    img_width: u32,
    img_height: u32,
) -> Result<crate::types::Rect> {
    if rect.width == 0 || rect.height == 0 {
        bail!("capture rect must be non-empty");
    }
    if rect.width > img_width || rect.height > img_height {
        bail!("capture rect is larger than captured monitor");
    }

    let max_x = (img_width - rect.width) as i32;
    let max_y = (img_height - rect.height) as i32;

    Ok(crate::types::Rect {
        x: rect.x.clamp(0, max_x),
        y: rect.y.clamp(0, max_y),
        width: rect.width,
        height: rect.height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Rect;

    #[test]
    fn clamp_capture_rect_keeps_size_when_right_edge_rounds_past_image() {
        let rect = clamp_capture_rect_to_image(
            Rect {
                x: 8,
                y: 1,
                width: 4,
                height: 3,
            },
            10,
            6,
        )
        .expect("rect should fit after shifting");

        assert_eq!(rect.x, 6);
        assert_eq!(rect.y, 1);
        assert_eq!(rect.width, 4);
        assert_eq!(rect.height, 3);
    }

    #[test]
    fn clamp_capture_rect_rejects_rect_larger_than_image() {
        let err = clamp_capture_rect_to_image(
            Rect {
                x: 0,
                y: 0,
                width: 11,
                height: 3,
            },
            10,
            6,
        )
        .expect_err("oversized rect cannot be captured");

        assert!(err.to_string().contains("larger than captured monitor"));
    }
}
