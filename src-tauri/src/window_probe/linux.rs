use crate::types::{Rect, WindowRect};
use anyhow::{Context, Result};
use xcap::Window;

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let windows = Window::all().context("Failed to enumerate windows via X11")?;

    let mut out = Vec::new();
    for win in windows {
        if win.is_minimized().unwrap_or(false) {
            continue;
        }
        let x = win.x().unwrap_or(0);
        let y = win.y().unwrap_or(0);
        let width = win.width().unwrap_or(0);
        let height = win.height().unwrap_or(0);
        if width < 2 || height < 2 {
            continue;
        }

        out.push(WindowRect {
            rect: Rect { x, y, width, height },
            title: win.title().unwrap_or_default(),
            app_name: win.app_name().unwrap_or_default(),
            pid: win.pid().unwrap_or(0),
        });
    }
    Ok(out)
}
