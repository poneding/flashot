use crate::pin_geometry::{
    PinRect, PinResizeDirection, PinResizeSession, PinToolKind, PinToolLayout, PinToolWindowState,
    place_tool_window, resize_image,
};
use crate::pin_mgr::PinManager;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const STATE_EVENT: &str = "pin:tools-state";
const PLACEMENT_EVENT: &str = "pin:tools-placement";

pub fn tool_label(pin_id: &str, kind: PinToolKind) -> String {
    format!(
        "pin-tools-{pin_id}-{}",
        match kind {
            PinToolKind::Controls => "controls",
            PinToolKind::Editor => "editor",
        }
    )
}

#[derive(Clone, Serialize)]
pub struct PinToolPlacement {
    pub side: &'static str,
}

fn pin_window(app: &AppHandle, mgr: &PinManager, pin_id: &str) -> Result<WebviewWindow, String> {
    let entry = mgr.get_pin(pin_id).ok_or("pin not found")?;
    app.get_webview_window(&entry.window_label)
        .ok_or_else(|| "pin window not found".into())
}

fn physical_rect(window: &WebviewWindow) -> Result<PinRect, String> {
    let p = window.outer_position().map_err(|e| e.to_string())?;
    let s = window.inner_size().map_err(|e| e.to_string())?;
    Ok(PinRect {
        x: p.x as f64,
        y: p.y as f64,
        width: s.width as f64,
        height: s.height as f64,
    })
}

/// Read real window bounds so delayed/lost DOM enter events in an inactive
/// palette cannot hide it while the pointer is moving over to its buttons.
pub fn interaction_contains_cursor(
    app: &AppHandle,
    mgr: &PinManager,
    pin_id: &str,
) -> Result<bool, String> {
    let parent = pin_window(app, mgr, pin_id)?;
    let tools: Vec<_> = [PinToolKind::Controls, PinToolKind::Editor]
        .into_iter()
        .filter_map(|kind| app.get_webview_window(&tool_label(pin_id, kind)))
        .filter(|window| window.is_visible().unwrap_or(false))
        .collect();
    #[cfg(target_os = "macos")]
    {
        macos::interaction_contains_cursor(&parent, &tools)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let cursor = app.cursor_position().map_err(|e| e.to_string())?;
        let dpi = parent.scale_factor().map_err(|e| e.to_string())?;
        let tools = tools
            .iter()
            .map(physical_rect)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(crate::pin_geometry::pin_interaction_contains_point(
            physical_rect(&parent)?,
            &tools,
            cursor.x,
            cursor.y,
            dpi,
        ))
    }
}

fn set_rect(window: &WebviewWindow, rect: PinRect) -> Result<(), String> {
    let size = PhysicalSize::new(
        rect.width.round().max(1.0) as u32,
        rect.height.round().max(1.0) as u32,
    );
    if window.inner_size().map_err(|e| e.to_string())? != size {
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    let position = PhysicalPosition::new(rect.x.round() as i32, rect.y.round() as i32);
    if window.outer_position().map_err(|e| e.to_string())? != position {
        window.set_position(position).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::{hide_tool_window, show_tool_window};

#[cfg(not(target_os = "macos"))]
fn show_tool_window(_parent: &WebviewWindow, window: &WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn hide_tool_window(window: &WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

fn ensure_tool_window(
    app: &AppHandle,
    _parent: &WebviewWindow,
    pin_id: &str,
    kind: PinToolKind,
) -> Result<(), String> {
    let label = tool_label(pin_id, kind);
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let kind_name = match kind {
        PinToolKind::Controls => "controls",
        PinToolKind::Editor => "editor",
    };
    let (width, height) = match kind {
        PinToolKind::Controls => (52.0, 224.0),
        PinToolKind::Editor => (560.0, 52.0),
    };
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App(format!("index.html#/pin-tools/{pin_id}/{kind_name}").into()),
    )
    .title("Flashot")
    .inner_size(width, height)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .accept_first_mouse(true)
    .visible(false);
    // AppKit's addChildWindow:ordered: can order a newly built child front even
    // with visible(false). Attach only after measuring and positioning it.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.parent(_parent).map_err(|e| e.to_string())?;
    let window = builder.build().map_err(|e| e.to_string())?;
    crate::commands::configure_pin_window_before_show(&window)?;
    Ok(())
}

pub fn sync_tools(
    app: &AppHandle,
    mgr: &Arc<PinManager>,
    pin_id: &str,
    state: serde_json::Value,
) -> Result<(), String> {
    let parent = pin_window(app, mgr, pin_id)?;
    let visible = state
        .get("visible")
        .and_then(|v| v.as_bool())
        .ok_or("invalid pin tool visibility")?;
    let editing = state
        .get("editing")
        .and_then(|v| v.as_bool())
        .ok_or("invalid pin editing state")?;
    let snapshot = mgr
        .set_tools_snapshot(pin_id, state)
        .ok_or("pin not found")?;
    if visible || editing {
        let created = ensure_tool_window(app, &parent, pin_id, PinToolKind::Controls);
        if mgr.get_pin(pin_id).is_none() {
            close_tools(app, pin_id);
            return Ok(());
        }
        created?;
    }
    if editing {
        let created = ensure_tool_window(app, &parent, pin_id, PinToolKind::Editor);
        if mgr.get_pin(pin_id).is_none() {
            close_tools(app, pin_id);
            return Ok(());
        }
        created?;
    }
    for kind in [PinToolKind::Controls, PinToolKind::Editor] {
        if let Some(window) = app.get_webview_window(&tool_label(pin_id, kind)) {
            window
                .emit_to(window.label(), STATE_EVENT, &snapshot)
                .map_err(|e| e.to_string())?;
        }
    }
    reposition_tools(app, mgr, pin_id);
    Ok(())
}

pub fn layout_tool(
    app: &AppHandle,
    mgr: &Arc<PinManager>,
    pin_id: &str,
    kind: PinToolKind,
    layout: PinToolLayout,
) -> Result<(), String> {
    if !layout.is_valid() {
        return Err("invalid pin tool bounds".into());
    }
    mgr.set_tool_layout(pin_id, kind, layout)
        .ok_or("pin not found")?;
    reposition_tools(app, mgr, pin_id);
    Ok(())
}

fn position_tools(app: &AppHandle, mgr: &PinManager, pin_id: &str) -> Result<(), String> {
    let Some(tools) = mgr.take_tool_presentations(pin_id) else {
        return Ok(());
    };
    let parent = pin_window(app, mgr, pin_id)?;
    let visible = parent.is_visible().unwrap_or(false);
    // Query the owner once per frame, shared by both palettes. Native child
    // geometry and visibility are cached instead of queried on every move.
    let geometry = if visible && tools.iter().any(|t| t.visible && t.layout.is_some()) {
        let monitor = parent
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("pin monitor not found")?;
        let work = monitor.work_area();
        Some((
            physical_rect(&parent)?,
            PinRect {
                x: work.position.x as f64,
                y: work.position.y as f64,
                width: work.size.width as f64,
                height: work.size.height as f64,
            },
            parent.scale_factor().map_err(|e| e.to_string())?,
        ))
    } else {
        None
    };

    for tool in tools {
        let Some(window) = app.get_webview_window(&tool_label(pin_id, tool.kind)) else {
            continue;
        };
        let Some((layout, (pin, work, dpi))) = tool.layout.zip(geometry).filter(|_| tool.visible)
        else {
            if let Some(applied) = tool.applied.filter(|s| s.visible) {
                hide_tool_window(&window)?;
                mgr.set_tool_window_state(
                    pin_id,
                    tool.kind,
                    PinToolWindowState {
                        visible: false,
                        ..applied
                    },
                );
            }
            continue;
        };
        let (rect, side) = place_tool_window(pin, work, layout, tool.kind, dpi);
        let rect = PinRect {
            x: rect.x.round(),
            y: rect.y.round(),
            width: rect.width.round(),
            height: rect.height.round(),
        };
        let previous = tool.applied.filter(|s| s.visible);
        let followed = previous.map(|s| s.followed_rect(pin, cfg!(target_os = "macos")));
        #[cfg(target_os = "macos")]
        if followed != Some(rect) {
            macos::set_tool_frame(&parent, &window, pin, rect, dpi)?;
        }
        #[cfg(not(target_os = "macos"))]
        if followed.is_none_or(|r| r.width != rect.width || r.height != rect.height) {
            window
                .set_size(PhysicalSize::new(rect.width as u32, rect.height as u32))
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "macos"))]
        if followed.is_none_or(|r| r.x != rect.x || r.y != rect.y) {
            window
                .set_position(PhysicalPosition::new(rect.x as i32, rect.y as i32))
                .map_err(|e| e.to_string())?;
        }
        if tool.notify_placement || tool.applied.is_none_or(|s| s.side != side) {
            window
                .emit_to(window.label(), PLACEMENT_EVENT, PinToolPlacement { side })
                .map_err(|e| e.to_string())?;
        }
        if previous.is_none() {
            show_tool_window(&parent, &window)?;
        }
        mgr.set_tool_window_state(
            pin_id,
            tool.kind,
            PinToolWindowState {
                rect,
                parent: pin,
                side,
                visible: true,
            },
        );
    }
    Ok(())
}

pub fn reposition_tools(app: &AppHandle, mgr: &Arc<PinManager>, pin_id: &str) {
    if !mgr.queue_tool_reposition(pin_id) {
        return;
    }
    schedule_tool_layout(app, mgr, pin_id);
}

/// Keep motion independent of popup measurements, screen-edge clamping and
/// timers. The native move event already contains the owner's new position.
pub fn move_tools(
    app: &AppHandle,
    mgr: &Arc<PinManager>,
    pin_id: &str,
    position: PhysicalPosition<i32>,
) {
    let Some(windows) = mgr.tool_windows(pin_id) else {
        return;
    };
    if windows
        .iter()
        .all(|(_, state)| state.is_none_or(|state| !state.visible))
    {
        return;
    }
    for (kind, applied) in windows {
        let Some(applied) = applied.filter(|s| s.visible) else {
            continue;
        };
        let parent = PinRect {
            x: position.x as f64,
            y: position.y as f64,
            ..applied.parent
        };
        let rect = applied.followed_rect(parent, true);
        #[cfg(not(target_os = "macos"))]
        if let Some(window) = app.get_webview_window(&tool_label(pin_id, kind))
            && let Err(error) = window.set_position(PhysicalPosition::new(
                rect.x.round() as i32,
                rect.y.round() as i32,
            ))
        {
            tracing::debug!("could not move pin tools: {error}");
            continue;
        }
        // macOS has already translated the attached child windows. Other
        // platforms do so above, directly in the native move callback.
        mgr.set_tool_window_state(
            pin_id,
            kind,
            PinToolWindowState {
                rect,
                parent,
                ..applied
            },
        );
    }
    if mgr.queue_tool_motion(pin_id) {
        schedule_tool_layout(app, mgr, pin_id);
    }
}

fn schedule_tool_layout(app: &AppHandle, mgr: &Arc<PinManager>, pin_id: &str) {
    let app = app.clone();
    let mgr = mgr.clone();
    let pin_id = pin_id.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(16)).await;
        loop {
            let Some(delay) = mgr.tool_reposition_delay(&pin_id) else {
                return;
            };
            if !delay.is_zero() {
                // A content/resize update can supersede this quiet period;
                // notice it within one frame without delaying live movement.
                tokio::time::sleep(delay.min(Duration::from_millis(16))).await;
                continue;
            }
            let task_app = app.clone();
            let task_mgr = mgr.clone();
            let task_id = pin_id.clone();
            let (tx, rx) = tokio::sync::oneshot::channel();
            if app
                .run_on_main_thread(move || {
                    let ready = task_mgr.take_tool_reposition(&task_id);
                    if ready && let Err(error) = position_tools(&task_app, &task_mgr, &task_id) {
                        tracing::debug!("could not position pin tools: {error}");
                    }
                    let _ = tx.send(ready);
                })
                .is_err()
                || rx.await.unwrap_or(true)
            {
                return;
            }
            // A newer move may have arrived while the main-thread task waited.
        }
    });
}

pub fn close_tools(app: &AppHandle, pin_id: &str) {
    for kind in [PinToolKind::Controls, PinToolKind::Editor] {
        if let Some(window) = app.get_webview_window(&tool_label(pin_id, kind)) {
            let _ = window.close();
        }
    }
}

pub fn begin_resize(
    app: &AppHandle,
    mgr: &PinManager,
    pin_id: &str,
    direction: PinResizeDirection,
) -> Result<String, String> {
    let window = pin_window(app, mgr, pin_id)?;
    let entry = mgr.get_pin(pin_id).ok_or("pin not found")?;
    let token = uuid::Uuid::new_v4().to_string();
    let origin = physical_rect(&window)?;
    let dpi = window.scale_factor().map_err(|e| e.to_string())?;
    let session = PinResizeSession {
        origin,
        scale: origin.width / dpi / entry.original_width as f64,
        dpi,
        direction,
    };
    mgr.begin_resize(pin_id, token.clone(), session)
        .ok_or("pin not found")?;
    Ok(token)
}

pub fn resize(
    app: &AppHandle,
    mgr: &Arc<PinManager>,
    pin_id: &str,
    token: &str,
    dx: f64,
    dy: f64,
) -> Result<f64, String> {
    let session = mgr
        .resize_session(pin_id, token)
        .ok_or("pin resize session ended")?;
    let entry = mgr.get_pin(pin_id).ok_or("pin not found")?;
    let window = pin_window(app, mgr, pin_id)?;
    let (rect, scale) = resize_image(session, entry.original_width, entry.original_height, dx, dy)
        .ok_or("invalid pin resize")?;
    set_rect(&window, rect)?;
    mgr.update_scale(pin_id, scale).ok_or("pin not found")?;
    reposition_tools(app, mgr, pin_id);
    Ok(scale)
}
