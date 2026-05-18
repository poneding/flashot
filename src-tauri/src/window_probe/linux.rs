use crate::types::{Rect, WindowRect};
use anyhow::{Context, Result};
use xcap::Window;
use xcb::{
    x::{Atom, GetProperty, Window as XcbWindow, ATOM_CARDINAL, ATOM_NONE, ATOM_WINDOW},
    Connection, XidNew,
};

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let windows = Window::all().context("Failed to enumerate windows via X11")?;
    let (conn, _) = Connection::connect(None).context("Failed to connect to X11")?;

    let mut out = Vec::new();
    for win in windows {
        if let Some(window) = window_rect_from_xcap_window(&conn, &win) {
            out.push(window);
        }
    }
    Ok(out)
}

pub fn active_window() -> Result<WindowRect> {
    let (conn, screen_num) = Connection::connect(None).context("Failed to connect to X11")?;
    let active_id = active_window_id(&conn, screen_num)?;
    let windows = Window::all().context("Failed to enumerate windows via X11")?;

    windows
        .into_iter()
        .find(|win| win.id().unwrap_or(0) == active_id)
        .and_then(|win| window_rect_from_xcap_window(&conn, &win))
        .ok_or_else(|| anyhow::anyhow!("active X11 window is not selectable"))
}

fn window_rect_from_xcap_window(conn: &Connection, win: &Window) -> Option<WindowRect> {
    if win.is_minimized().unwrap_or(false) {
        return None;
    }
    let x = win.x().unwrap_or(0);
    let y = win.y().unwrap_or(0);
    let width = win.width().unwrap_or(0);
    let height = win.height().unwrap_or(0);
    if width < 2 || height < 2 {
        return None;
    }

    // Correct for WM frame decorations (title bar + borders).
    // _NET_FRAME_EXTENTS = [left, right, top, bottom] in pixels.
    // xcap returns client-area coords; we expand to include the frame.
    let (x, y, width, height) =
        if let Some([left, right, top, bottom]) = frame_extents(conn, win.id().unwrap_or(0)) {
            (
                x - left as i32,
                y - top as i32,
                width + left + right,
                height + top + bottom,
            )
        } else {
            (x, y, width, height)
        };

    Some(WindowRect {
        rect: Rect {
            x,
            y,
            width,
            height,
        },
        title: win.title().unwrap_or_default(),
        app_name: win.app_name().unwrap_or_default(),
        pid: win.pid().unwrap_or(0),
    })
}

fn active_window_id(conn: &Connection, screen_num: i32) -> Result<u32> {
    let active_atom =
        intern_atom(conn, "_NET_ACTIVE_WINDOW").context("_NET_ACTIVE_WINDOW atom not found")?;
    let root = conn
        .get_setup()
        .roots()
        .nth(screen_num as usize)
        .context("X11 screen not found")?
        .root();
    let cookie = conn.send_request(&GetProperty {
        delete: false,
        window: root,
        property: active_atom,
        r#type: ATOM_WINDOW,
        long_offset: 0,
        long_length: 1,
    });
    let reply = conn
        .wait_for_reply(cookie)
        .context("Failed to read _NET_ACTIVE_WINDOW")?;
    let values = reply.value::<u32>();
    values
        .first()
        .copied()
        .filter(|id| *id != 0)
        .context("X11 active window is empty")
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
