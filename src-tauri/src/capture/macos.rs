use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{Context, Result};
use xcap::Monitor;

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    tracing::info!("capture_all_monitors: starting");
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    tracing::info!("capture_all_monitors: found {} monitors", monitors.len());
    let mut infos = Vec::new();
    let mut frames = Vec::new();

    for (idx, mon) in monitors.iter().enumerate() {
        tracing::info!("capture_all_monitors: processing monitor {}", idx);
        let id = idx as u32;
        let scale = mon.scale_factor().context("Failed to get scale factor")?;
        let x = mon.x().context("Failed to get x coordinate")?;
        let y = mon.y().context("Failed to get y coordinate")?;
        let w = mon.width().context("Failed to get width")?;
        let h = mon.height().context("Failed to get height")?;
        tracing::info!(
            "capture_all_monitors: monitor {} - {}x{} at ({}, {}), scale {}",
            id,
            w,
            h,
            x,
            y,
            scale
        );

        infos.push(MonitorInfo {
            id,
            rect: Rect {
                x,
                y,
                width: w,
                height: h,
            },
            scale_factor: scale,
        });

        tracing::info!("capture_all_monitors: capturing monitor {}", id);
        let img = mon.capture_image().context("Failed to capture monitor")?;
        let (frame_width, frame_height) =
            captured_frame_dimensions(img.width(), img.height(), w, h);
        let rgba = img.into_raw();
        tracing::info!(
            "capture_all_monitors: captured {} bytes for monitor {} ({}x{} physical)",
            rgba.len(),
            id,
            frame_width,
            frame_height
        );
        frames.push(FrozenFrame {
            monitor_id: id,
            rgba,
            width: frame_width,
            height: frame_height,
            scale_factor: scale,
        });
    }

    tracing::info!("capture_all_monitors: completed successfully");
    Ok((infos, frames))
}

fn captured_frame_dimensions(
    image_width: u32,
    image_height: u32,
    _logical_width: u32,
    _logical_height: u32,
) -> (u32, u32) {
    (image_width, image_height)
}

#[cfg(test)]
mod tests {
    use super::captured_frame_dimensions;

    #[test]
    fn captured_frame_dimensions_use_image_pixels_not_monitor_logical_size() {
        let (width, height) = captured_frame_dimensions(4608, 2592, 2304, 1296);

        assert_eq!((width, height), (4608, 2592));
    }
}
