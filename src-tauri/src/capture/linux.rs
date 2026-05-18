use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{Context, Result};
use xcap::Monitor;

pub fn enumerate_monitors() -> Result<Vec<MonitorInfo>> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    monitors.iter().map(monitor_info).collect()
}

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    let mut infos = Vec::new();
    let mut frames = Vec::new();

    for mon in monitors.iter() {
        let info = monitor_info(mon)?;

        let img = mon.capture_image().context("Failed to capture monitor")?;
        let frame_width = img.width();
        let frame_height = img.height();
        let rgba = img.into_raw();
        frames.push(FrozenFrame {
            monitor_id: info.id,
            rgba,
            width: frame_width,
            height: frame_height,
            scale_factor: info.scale_factor,
        });
        infos.push(info);
    }

    Ok((infos, frames))
}

fn monitor_info(mon: &Monitor) -> Result<MonitorInfo> {
    let id = mon.id().context("Failed to get monitor id")?;
    let scale = mon.scale_factor().context("Failed to get scale factor")?;
    let x = mon.x().context("Failed to get x coordinate")?;
    let y = mon.y().context("Failed to get y coordinate")?;
    let w = mon.width().context("Failed to get width")?;
    let h = mon.height().context("Failed to get height")?;

    Ok(MonitorInfo {
        id,
        rect: Rect {
            x,
            y,
            width: w,
            height: h,
        },
        scale_factor: scale,
    })
}
