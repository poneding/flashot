use crate::types::{Rect, WindowRect};
use anyhow::{Context, Result};
use xcap::Window;
use xcb::{
    x::{Atom, GetProperty, Window as XcbWindow, ATOM_CARDINAL, ATOM_NONE},
    Connection, XidNew,
};

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let windows = Window::all().context("Failed to enumerate windows via X11")?;
    let (conn, _) = Connection::connect(None).context("Failed to connect to X11")?;

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

        // Correct for WM frame decorations (title bar + borders).
        // _NET_FRAME_EXTENTS = [left, right, top, bottom] in pixels.
        // xcap returns client-area coords; we expand to include the frame.
        let (x, y, width, height) =
            if let Some([left, right, top, bottom]) = frame_extents(&conn, win.id().unwrap_or(0)) {
                (
                    x - left as i32,
                    y - top as i32,
                    width + left + right,
                    height + top + bottom,
                )
            } else {
                (x, y, width, height)
            };

        out.push(WindowRect {
            rect: Rect {
                x,
                y,
                width,
                height,
            },
            title: win.title().unwrap_or_default(),
            app_name: win.app_name().unwrap_or_default(),
            pid: win.pid().unwrap_or(0),
        });
    }
    Ok(out)
}

/// Returns [left, right, top, bottom] frame extents, or None if the property
/// is absent or all-zero (undecorated / tiling WM).
fn frame_extents(conn: &Connection, window_id: u32) -> Option<[u32; 4]> {
    let atom = intern_atom(conn, "_NET_FRAME_EXTENTS")?;
    let cookie = conn.send_request(&GetProperty {
        delete: false,
        window: XcbWindow::new(window_id),
        property: atom,
        r#type: ATOM_CARDINAL,
        long_offset: 0,
        long_length: 4,
    });
    let reply = conn.wait_for_reply(cookie).ok()?;
    let values = reply.value::<u32>();
    if values.len() < 4 {
        return None;
    }
    let extents = [values[0], values[1], values[2], values[3]];
    if extents == [0, 0, 0, 0] {
        return None;
    }
    Some(extents)
}

fn intern_atom(conn: &Connection, name: &str) -> Option<Atom> {
    let cookie = conn.send_request(&xcb::x::InternAtom {
        only_if_exists: true,
        name: name.as_bytes(),
    });
    let reply = conn.wait_for_reply(cookie).ok()?;
    let atom = reply.atom();
    if atom == ATOM_NONE {
        None
    } else {
        Some(atom)
    }
}
