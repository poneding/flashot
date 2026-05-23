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
pub use linux::{capture_all_monitors, enumerate_monitors};

use anyhow::{Context, Result};

/// Capture a single monitor and crop to the given physical-pixel rect.
/// Used by scroll capture loop — returns just the selection bytes, no disk I/O.
pub fn capture_monitor_region(monitor_id: u32, rect_physical: crate::types::Rect) -> Result<Vec<u8>> {
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
    let rgba = img.into_raw();

    let rect_x = rect_physical.x as u32;
    let rect_y = rect_physical.y as u32;
    let row_bytes = (rect_physical.width as usize) * 4;
    let mut out = Vec::with_capacity(row_bytes * rect_physical.height as usize);
    for row in 0..rect_physical.height {
        let y = rect_y + row;
        let start = (y * img_width + rect_x) as usize * 4;
        let end = start + row_bytes;
        out.extend_from_slice(&rgba[start..end]);
    }
    Ok(out)
}
