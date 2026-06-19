use crate::types::{FrozenFrame, MonitorInfo, Rect};
use anyhow::{anyhow, bail, Context, Result};
use image::RgbaImage;
use xcap::Monitor;

pub fn enumerate_monitors() -> Result<Vec<MonitorInfo>> {
    if is_wayland_session() {
        match enumerate_wayland_monitors() {
            Ok(monitors) => return Ok(monitors),
            Err(e) => tracing::warn!(
                "Wayland monitor enumeration failed, falling back to xcap/XRandR: {e:#}"
            ),
        }
    }

    enumerate_xcap_monitors()
}

pub fn capture_all_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    if is_wayland_session() {
        match capture_all_wayland_monitors() {
            Ok(result) => return Ok(result),
            Err(e) => {
                tracing::warn!(
                    "Wayland wlroots capture failed, falling back to xdg-desktop-portal: {e:#}"
                )
            }
        }

        match capture_all_portal_monitors() {
            Ok(result) => return Ok(result),
            Err(e) => {
                tracing::warn!(
                    "Wayland portal capture failed, falling back to GNOME Shell screenshot: {e:#}"
                )
            }
        }

        match capture_all_gnome_shell_monitors() {
            Ok(result) => return Ok(result),
            Err(e) => {
                tracing::warn!("GNOME Shell screenshot failed, falling back to xcap: {e:#}")
            }
        }
    }

    capture_all_xcap_monitors()
}

fn enumerate_xcap_monitors() -> Result<Vec<MonitorInfo>> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    monitors.iter().map(monitor_info).collect()
}

fn capture_all_xcap_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
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
            icc_profile: None,
        });
        infos.push(info);
    }

    Ok((infos, frames))
}

fn enumerate_wayland_monitors() -> Result<Vec<MonitorInfo>> {
    let conn = wayland_connection()?;
    let monitors: Vec<_> = conn
        .get_all_outputs()
        .iter()
        .enumerate()
        .map(|(index, output)| monitor_info_from_wayland_output(index, output))
        .collect();

    if monitors.is_empty() {
        bail!("Wayland compositor did not report any outputs");
    }

    Ok(monitors)
}

fn capture_all_wayland_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    let conn = wayland_connection()?;
    let outputs = conn.get_all_outputs().to_vec();

    if outputs.is_empty() {
        bail!("Wayland compositor did not report any outputs");
    }

    let mut infos = Vec::with_capacity(outputs.len());
    let mut frames = Vec::with_capacity(outputs.len());

    for (index, output) in outputs.iter().enumerate() {
        let info = monitor_info_from_wayland_output(index, output);
        let image = conn
            .screenshot_single_output(output, false)
            .with_context(|| format!("Failed to capture Wayland output {}", output.name))?;
        let rgba_image = image.to_rgba8();
        let frame_width = rgba_image.width();
        let frame_height = rgba_image.height();

        frames.push(FrozenFrame {
            monitor_id: info.id,
            rgba: rgba_image.into_raw(),
            width: frame_width,
            height: frame_height,
            scale_factor: info.scale_factor,
            icc_profile: None,
        });
        infos.push(info);
    }

    Ok((infos, frames))
}

fn capture_all_portal_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    let monitors = enumerate_wayland_monitors()
        .or_else(|e| {
            tracing::warn!(
                "Portal capture could not reuse Wayland monitor geometry, trying xcap geometry: {e:#}"
            );
            enumerate_xcap_monitors()
        })
        .context("Failed to enumerate monitors for portal capture")?;

    let screenshot = request_portal_screenshot(false)
        .or_else(|e| {
            tracing::warn!(
                "Non-interactive portal screenshot failed, trying interactive portal screenshot: {e:#}"
            );
            request_portal_screenshot(true)
        })
        .context("Failed to request portal screenshot")?;
    let path = super::portal_uri::portal_screenshot_uri_to_path(screenshot.uri().as_str())?;
    let bytes = std::fs::read(&path)
        .with_context(|| format!("Failed to read portal screenshot {}", path.display()))?;
    let image = image::load_from_memory(&bytes)
        .context("Failed to decode portal screenshot")?
        .to_rgba8();

    split_portal_screenshot(monitors, image)
}

fn capture_all_gnome_shell_monitors() -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    let monitors = enumerate_wayland_monitors()
        .or_else(|e| {
            tracing::warn!(
                "GNOME Shell capture could not reuse Wayland monitor geometry, trying xcap geometry: {e:#}"
            );
            enumerate_xcap_monitors()
        })
        .context("Failed to enumerate monitors for GNOME Shell capture")?;

    let path =
        request_gnome_shell_screenshot().context("Failed to request GNOME Shell screenshot")?;
    let bytes = std::fs::read(&path)
        .with_context(|| format!("Failed to read GNOME Shell screenshot {}", path.display()))?;
    let image = image::load_from_memory(&bytes)
        .context("Failed to decode GNOME Shell screenshot")?
        .to_rgba8();
    if let Err(e) = std::fs::remove_file(&path) {
        tracing::warn!(
            "Failed to remove temporary GNOME Shell screenshot {}: {e}",
            path.display()
        );
    }

    split_portal_screenshot(monitors, image)
}

fn request_portal_screenshot(interactive: bool) -> Result<ashpd::desktop::screenshot::Screenshot> {
    let request = async {
        ashpd::desktop::screenshot::Screenshot::request()
            .interactive(interactive)
            .modal(false)
            .send()
            .await?
            .response()
    };

    match tokio::runtime::Handle::try_current() {
        Ok(handle) => handle
            .block_on(request)
            .context("Portal screenshot request failed"),
        Err(_) => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .context("Failed to create runtime for portal screenshot")?;
            runtime
                .block_on(request)
                .context("Portal screenshot request failed")
        }
    }
}

fn request_gnome_shell_screenshot() -> Result<std::path::PathBuf> {
    let path = std::env::temp_dir().join("flashot").join(format!(
        "gnome-shell-screenshot-{}.png",
        uuid::Uuid::new_v4()
    ));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }

    let connection = zbus::blocking::Connection::session().context("Failed to connect to D-Bus")?;
    let proxy = zbus::blocking::Proxy::new(
        &connection,
        "org.gnome.Shell.Screenshot",
        "/org/gnome/Shell/Screenshot",
        "org.gnome.Shell.Screenshot",
    )
    .context("Failed to connect to org.gnome.Shell.Screenshot")?;

    let filename = path.to_string_lossy().to_string();
    let (success, used_filename): (bool, String) = proxy
        .call("Screenshot", &(false, false, filename.as_str()))
        .context("GNOME Shell Screenshot call failed")?;
    if !success {
        bail!("GNOME Shell Screenshot returned success=false");
    }

    let used_path = if used_filename.is_empty() {
        path
    } else {
        std::path::PathBuf::from(used_filename)
    };
    if !used_path.exists() {
        bail!(
            "GNOME Shell Screenshot returned {}, but the file does not exist",
            used_path.display()
        );
    }

    Ok(used_path)
}

fn split_portal_screenshot(
    monitors: Vec<MonitorInfo>,
    image: RgbaImage,
) -> Result<(Vec<MonitorInfo>, Vec<FrozenFrame>)> {
    if monitors.is_empty() {
        bail!("Portal capture has no monitors to map");
    }

    let image_width = image.width();
    let image_height = image.height();
    if image_width == 0 || image_height == 0 {
        bail!("Portal screenshot is empty");
    }

    let desktop = monitor_union(&monitors)?;
    let scale_x = image_width as f32 / desktop.width as f32;
    let scale_y = image_height as f32 / desktop.height as f32;
    if !scale_x.is_finite() || scale_x <= 0.0 || !scale_y.is_finite() || scale_y <= 0.0 {
        bail!("Portal screenshot scale is invalid: {scale_x}x{scale_y}");
    }

    let rgba = image.into_raw();
    let mut adjusted_monitors = Vec::with_capacity(monitors.len());
    let mut frames = Vec::with_capacity(monitors.len());

    for monitor in monitors {
        let crop = scaled_monitor_rect(
            &monitor.rect,
            &desktop,
            scale_x,
            scale_y,
            image_width,
            image_height,
        )?;
        let frame_rgba = crop_rgba(&rgba, image_width, crop)?;
        let scale_factor = portal_frame_scale_factor(&monitor, crop);
        let mut adjusted_monitor = monitor;
        adjusted_monitor.scale_factor = scale_factor;

        frames.push(FrozenFrame {
            monitor_id: adjusted_monitor.id,
            rgba: frame_rgba,
            width: crop.width,
            height: crop.height,
            scale_factor,
            icc_profile: None,
        });
        adjusted_monitors.push(adjusted_monitor);
    }

    Ok((adjusted_monitors, frames))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DesktopBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ImageRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn monitor_union(monitors: &[MonitorInfo]) -> Result<DesktopBounds> {
    let min_x = monitors
        .iter()
        .map(|monitor| monitor.rect.x)
        .min()
        .context("No monitor x coordinate")?;
    let min_y = monitors
        .iter()
        .map(|monitor| monitor.rect.y)
        .min()
        .context("No monitor y coordinate")?;
    let max_x = monitors
        .iter()
        .map(|monitor| monitor.rect.x as i64 + monitor.rect.width as i64)
        .max()
        .context("No monitor right edge")?;
    let max_y = monitors
        .iter()
        .map(|monitor| monitor.rect.y as i64 + monitor.rect.height as i64)
        .max()
        .context("No monitor bottom edge")?;

    let width = max_x - min_x as i64;
    let height = max_y - min_y as i64;
    if width <= 0 || height <= 0 {
        bail!("Monitor union is empty");
    }

    Ok(DesktopBounds {
        x: min_x,
        y: min_y,
        width: width as u32,
        height: height as u32,
    })
}

fn scaled_monitor_rect(
    rect: &Rect,
    desktop: &DesktopBounds,
    scale_x: f32,
    scale_y: f32,
    image_width: u32,
    image_height: u32,
) -> Result<ImageRect> {
    let left = scaled_edge(rect.x, desktop.x, scale_x, image_width);
    let top = scaled_edge(rect.y, desktop.y, scale_y, image_height);
    let right = scaled_edge(
        rect.x.saturating_add_unsigned(rect.width),
        desktop.x,
        scale_x,
        image_width,
    );
    let bottom = scaled_edge(
        rect.y.saturating_add_unsigned(rect.height),
        desktop.y,
        scale_y,
        image_height,
    );

    if right <= left || bottom <= top {
        bail!("Scaled monitor rect is empty");
    }

    Ok(ImageRect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

fn scaled_edge(edge: i32, origin: i32, scale: f32, max: u32) -> u32 {
    (((edge - origin) as f32) * scale)
        .round()
        .clamp(0.0, max as f32) as u32
}

fn crop_rgba(rgba: &[u8], image_width: u32, crop: ImageRect) -> Result<Vec<u8>> {
    let row_bytes = crop.width as usize * 4;
    let mut out = Vec::with_capacity(row_bytes * crop.height as usize);
    for row in 0..crop.height {
        let y = crop.y + row;
        let start = (y * image_width + crop.x) as usize * 4;
        let end = start + row_bytes;
        let slice = rgba
            .get(start..end)
            .with_context(|| format!("Portal screenshot crop row {row} is out of bounds"))?;
        out.extend_from_slice(slice);
    }
    Ok(out)
}

fn portal_frame_scale_factor(monitor: &MonitorInfo, crop: ImageRect) -> f32 {
    let width_scale = if monitor.rect.width > 0 {
        crop.width as f32 / monitor.rect.width as f32
    } else {
        0.0
    };
    let height_scale = if monitor.rect.height > 0 {
        crop.height as f32 / monitor.rect.height as f32
    } else {
        0.0
    };
    let scale = width_scale.max(height_scale);

    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        monitor.scale_factor
    }
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

fn monitor_info_from_wayland_output(
    index: usize,
    output: &libwayshot_xcap::output::OutputInfo,
) -> MonitorInfo {
    let region = output.logical_region.inner;

    MonitorInfo {
        id: stable_wayland_output_id(index, output),
        rect: Rect {
            x: region.position.x,
            y: region.position.y,
            width: region.size.width,
            height: region.size.height,
        },
        scale_factor: wayland_output_scale_factor(output),
    }
}

fn stable_wayland_output_id(index: usize, output: &libwayshot_xcap::output::OutputInfo) -> u32 {
    let key = if output.name.is_empty() {
        output.description.as_str()
    } else {
        output.name.as_str()
    };
    let mut hash = 0x811c9dc5_u32;
    for byte in key
        .as_bytes()
        .iter()
        .copied()
        .chain([0xff])
        .chain(index.to_le_bytes())
    {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

fn wayland_output_scale_factor(output: &libwayshot_xcap::output::OutputInfo) -> f32 {
    let logical = output.logical_region.inner.size;
    let physical = output.physical_size;

    let width_scale = if logical.width > 0 {
        physical.width as f32 / logical.width as f32
    } else {
        0.0
    };
    let height_scale = if logical.height > 0 {
        physical.height as f32 / logical.height as f32
    } else {
        0.0
    };
    let scale = width_scale.max(height_scale);

    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

fn wayland_connection() -> Result<libwayshot_xcap::WayshotConnection> {
    std::panic::catch_unwind(libwayshot_xcap::WayshotConnection::new)
        .map_err(|_| anyhow!("Wayland output discovery panicked"))?
        .context("Failed to connect to Wayland compositor")
}

fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|session| session.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_mapping_splits_horizontal_monitors() {
        let monitors = vec![
            MonitorInfo {
                id: 1,
                rect: Rect {
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 50,
                },
                scale_factor: 1.0,
            },
            MonitorInfo {
                id: 2,
                rect: Rect {
                    x: 100,
                    y: 0,
                    width: 100,
                    height: 50,
                },
                scale_factor: 1.0,
            },
        ];
        let desktop = monitor_union(&monitors).unwrap();

        assert_eq!(
            scaled_monitor_rect(&monitors[0].rect, &desktop, 2.0, 2.0, 400, 100).unwrap(),
            ImageRect {
                x: 0,
                y: 0,
                width: 200,
                height: 100,
            }
        );
        assert_eq!(
            scaled_monitor_rect(&monitors[1].rect, &desktop, 2.0, 2.0, 400, 100).unwrap(),
            ImageRect {
                x: 200,
                y: 0,
                width: 200,
                height: 100,
            }
        );
    }

    #[test]
    fn portal_mapping_handles_negative_monitor_origins() {
        let monitors = vec![MonitorInfo {
            id: 1,
            rect: Rect {
                x: -1280,
                y: -200,
                width: 1280,
                height: 720,
            },
            scale_factor: 1.0,
        }];
        let desktop = monitor_union(&monitors).unwrap();

        assert_eq!(
            scaled_monitor_rect(&monitors[0].rect, &desktop, 1.0, 1.0, 1280, 720).unwrap(),
            ImageRect {
                x: 0,
                y: 0,
                width: 1280,
                height: 720,
            }
        );
    }

    #[test]
    fn portal_crop_reads_expected_rgba_rows() {
        let rgba: Vec<u8> = (0..4 * 4 * 4).map(|value| value as u8).collect();
        let cropped = crop_rgba(
            &rgba,
            4,
            ImageRect {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        )
        .unwrap();

        let pixel_offset = |x: usize, y: usize| (y * 4 + x) * 4;
        let row_1 = pixel_offset(1, 1)..pixel_offset(3, 1);
        let row_2 = pixel_offset(1, 2)..pixel_offset(3, 2);
        let expected: Vec<u8> = rgba[row_1]
            .iter()
            .chain(rgba[row_2].iter())
            .copied()
            .collect();
        assert_eq!(cropped, expected);
    }
}
