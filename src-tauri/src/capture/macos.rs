use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{Context, Result};
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
        let img = mon.capture_image().context("Failed to capture monitor")?;
        let (frame_width, frame_height) =
            captured_frame_dimensions(img.width(), img.height(), info.rect.width, info.rect.height);
        let rgba = img.into_raw();
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
        });
        infos.push(info);
    }

    tracing::info!("capture_all_monitors: completed successfully");
    Ok((infos, frames))
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
    use super::{captured_frame_dimensions, monitor_info_from_parts};

    #[test]
    fn captured_frame_dimensions_use_image_pixels_not_monitor_logical_size() {
        let (width, height) = captured_frame_dimensions(4608, 2592, 2304, 1296);

        assert_eq!((width, height), (4608, 2592));
    }

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
}
