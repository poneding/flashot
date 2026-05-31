use crate::types::Rect;
use anyhow::{anyhow, Context, Result};
use libwayshot_xcap::region::{LogicalRegion, Position, Region, Size};
use std::time::Duration;

use super::{ScrollCaptureSession, ScrollFrameSource};

pub(crate) struct WaylandScreencopyScrollCapture {
    region: LogicalRegion,
}

impl WaylandScreencopyScrollCapture {
    pub(crate) fn new(monitor_rect: Rect, logical_selection: Rect) -> Result<Self> {
        let region = selection_to_logical_region(monitor_rect, logical_selection)?;
        Ok(Self { region })
    }

    pub(crate) fn into_session(self) -> Result<ScrollCaptureSession> {
        let initial = self.capture_once()?;
        Ok(ScrollCaptureSession {
            width: initial.width,
            height: initial.height,
            initial_frame: initial.rgba,
            source: Box::new(self),
        })
    }

    fn capture_once(&self) -> Result<CapturedWayshotFrame> {
        let conn = wayland_connection()?;
        let image = conn
            .screenshot(self.region, false)
            .context("failed to capture wayland scroll region with screencopy")?
            .to_rgba8();
        let width = image.width();
        let height = image.height();
        let rgba = image.into_raw();
        if rgba.is_empty() || width == 0 || height == 0 {
            anyhow::bail!("wayland screencopy produced an empty frame");
        }
        Ok(CapturedWayshotFrame {
            rgba,
            width,
            height,
        })
    }
}

impl ScrollFrameSource for WaylandScreencopyScrollCapture {
    fn next_frame(&mut self, _timeout: Duration) -> Result<Vec<u8>> {
        Ok(self.capture_once()?.rgba)
    }
}

struct CapturedWayshotFrame {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

fn selection_to_logical_region(monitor_rect: Rect, selection: Rect) -> Result<LogicalRegion> {
    if selection.width == 0 || selection.height == 0 {
        anyhow::bail!("wayland scroll selection must not be empty");
    }

    Ok(LogicalRegion {
        inner: Region {
            position: Position {
                x: monitor_rect.x + selection.x,
                y: monitor_rect.y + selection.y,
            },
            size: Size {
                width: selection.width,
                height: selection.height,
            },
        },
    })
}

fn wayland_connection() -> Result<libwayshot_xcap::WayshotConnection> {
    std::panic::catch_unwind(libwayshot_xcap::WayshotConnection::new)
        .map_err(|_| anyhow!("Wayland screencopy output discovery panicked"))?
        .context("failed to connect to Wayland compositor for screencopy")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_monitor_local_selection_to_global_logical_region() {
        let region = selection_to_logical_region(
            Rect {
                x: 1920,
                y: -120,
                width: 1600,
                height: 900,
            },
            Rect {
                x: 50,
                y: 80,
                width: 300,
                height: 240,
            },
        )
        .unwrap();

        assert_eq!(region.inner.position.x, 1970);
        assert_eq!(region.inner.position.y, -40);
        assert_eq!(region.inner.size.width, 300);
        assert_eq!(region.inner.size.height, 240);
    }

    #[test]
    fn rejects_empty_selection() {
        let err = selection_to_logical_region(
            Rect {
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            },
            Rect {
                x: 0,
                y: 0,
                width: 0,
                height: 100,
            },
        )
        .expect_err("empty selection should fail");

        assert!(err.to_string().contains("must not be empty"));
    }
}
