use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{Context, Result};
use xcap::Monitor;

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    let mut infos = Vec::new();
    let mut frames = Vec::new();

    for (idx, mon) in monitors.iter().enumerate() {
        let id = idx as u32;
        let scale = mon.scale_factor();
        let x = mon.x();
        let y = mon.y();
        let w = mon.width();
        let h = mon.height();

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

        let img = mon.capture_image().context("Failed to capture monitor")?;
        let frame_width = img.width();
        let frame_height = img.height();
        let rgba = img.into_raw();
        frames.push(FrozenFrame {
            monitor_id: id,
            rgba,
            width: frame_width,
            height: frame_height,
            scale_factor: scale,
        });
    }

    Ok((infos, frames))
}
