# Wayland Scroll Capture Design

- **Date**: 2026-05-29
- **Status**: Approved for planning
- **Scope**: Scrolling screenshot on Linux Wayland desktops through xdg-desktop-portal ScreenCast and PipeWire.

## 1. Goal

Flashot's scrolling screenshot must work on Wayland sessions across GNOME, KDE, wlroots-based compositors, and Hyprland when a working `org.freedesktop.portal.ScreenCast` implementation is available. The implementation must not regress normal screenshots or existing scrolling screenshots on macOS, Windows, or Linux X11.

The current failure is specific to the scrolling path: normal Linux Wayland screenshots use `capture_all_monitors()` with wlroots, xdg-desktop-portal screenshot, and GNOME Shell fallbacks, while scrolling screenshot calls `capture_monitor_region()` directly. That helper captures through `xcap::Monitor::capture_image()` only, so Wayland sessions without direct screencopy support fail at the first live frame and the frontend rolls back to the selection UI.

## 2. Non-Goals

- No automated scrolling. The user still scrolls the underlying application.
- No compositor-private protocols as the primary path. Portal ScreenCast is the support boundary.
- No broad rewrite of normal screenshot capture.
- No annotation or pin support for stitched output.
- No guarantee for systems with no ScreenCast portal, disabled PipeWire, or denied user permission. These must fail with a clear message.

## 3. Requirements

- Wayland scroll capture uses `org.freedesktop.portal.ScreenCast`, not repeated screenshot portal requests.
- The first portal permission prompt is acceptable. Returned restore tokens should be stored and reused when the portal provides them.
- The current macOS, Windows, and Linux X11 scroll path keeps using `xcap` unless a future change replaces it explicitly.
- The backend exposes one scroll-frame abstraction so the stitcher and progress events do not care whether frames come from xcap or PipeWire.
- The Wayland path must handle monitor streams whose logical portal size differs from the raw PipeWire buffer size.
- Errors must be visible in the frontend. The UI must not silently flash and return to the selection box.
- Session cleanup must stop PipeWire streams and close portal sessions through the existing RAII lifecycle.

## 4. Architecture

### 4.1 Scroll Capture Provider

Add `src-tauri/src/scroll_capture/` with a backend-neutral session:

```rust
pub(crate) struct ScrollCaptureSession {
    pub initial_frame: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source: Box<dyn ScrollFrameSource>,
}

pub(crate) trait ScrollFrameSource: Send {
    fn next_frame(&mut self, timeout: std::time::Duration) -> anyhow::Result<Vec<u8>>;
}
```

`start_scroll_session` will request a `ScrollCaptureSession` from a factory. The factory receives the monitor id, the original logical selection rect, the current physical rect, and monitor metadata. It selects:

- `XcapScrollCapture` for macOS, Windows, and Linux X11.
- `WaylandScrollCapture` for Linux Wayland when ScreenCast is available.

The existing `ScrollStitcher` keeps its current role. `scroll_session::spawn_loop` changes from "capture monitor id + rect every tick" to "ask the source for the next frame every tick".

### 4.2 Xcap Provider

Move the current `capture_monitor_region()` logic behind `XcapScrollCapture`. This preserves current behavior. The public helper can remain for compatibility, but the scroll loop should not hard-code it.

### 4.3 Wayland Provider

The Wayland provider has three layers:

1. `portal.rs`: uses `ashpd 0.8.1` to create a ScreenCast session, select monitor sources, start the session, read stream metadata, and open the PipeWire remote fd.
2. `pipewire.rs`: connects to the portal-provided remote, consumes raw video buffers from the selected node, converts supported formats to RGBA, and publishes the latest frame.
3. `mapping.rs`: maps Flashot's logical monitor-local selection to raw stream pixels.

Portal call sequence:

```rust
let proxy = ashpd::desktop::screencast::Screencast::new().await?;
let session = proxy.create_session().await?;
proxy
    .select_sources(
        &session,
        CursorMode::Hidden,
        SourceType::Monitor.into(),
        true,
        restore_token.as_deref(),
        PersistMode::ExplicitlyRevoked,
    )
    .await?
    .response()?;
let response = proxy.start(&session, &WindowIdentifier::default()).await?.response()?;
let remote_fd = proxy.open_pipe_wire_remote(&session).await?;
```

If a portal returns a restore token, persist it in settings and pass it into the next `select_sources` call.

### 4.4 Stream Selection and Coordinates

Prefer streams with `source_type == Monitor`. Selection order:

1. A stream whose portal `position` and `size` contain the target monitor center in compositor logical coordinates.
2. A stream whose portal `position` equals the target monitor origin and whose `size` matches the target monitor logical size.
3. The only monitor stream when there is exactly one.

The selected stream has logical bounds from portal metadata and raw bounds from the negotiated PipeWire format. The crop mapping is:

```text
scale_x = raw_width / stream_logical_width
scale_y = raw_height / stream_logical_height
crop_x = round((monitor_rect.x + selection.x - stream_position.x) * scale_x)
crop_y = round((monitor_rect.y + selection.y - stream_position.y) * scale_y)
crop_w = round(selection.width * scale_x)
crop_h = round(selection.height * scale_y)
```

The crop is clamped to the raw stream frame. The computed `crop_w` and `crop_h` define the stitcher frame dimensions.

### 4.5 PipeWire Frame Handling

The consumer negotiates raw formats in this order: `RGBA`, `RGBx`, `BGRA`, `BGRx`, `RGB`, `BGR`. It must honor per-plane stride when present instead of assuming packed rows.

The PipeWire thread writes the latest cropped RGBA frame into a small latest-frame buffer guarded by `Mutex + Condvar`. `ScrollFrameSource::next_frame(timeout)` waits for a newer sequence number and returns the newest frame. If frames stop arriving, it returns a timeout error that the scroll loop logs and retries until cancellation.

### 4.6 Overlay Behavior on Wayland

Wayland does not provide a portable local-region pointer passthrough mechanism. During Wayland scroll mode:

- The backend starts ScreenCast and captures the first frame before hiding the selection overlay.
- After success, the frontend enters `scrolling`, and the backend hides the main `overlay-{monitor_id}` window so wheel and touch events reach the underlying app.
- The `overlay-chrome-{monitor_id}` window remains visible and positioned outside the selected rect when possible.
- On start failure, the overlay remains in committed mode and the frontend shows the error.

macOS, Windows, and X11 keep their current full-window passthrough behavior.

### 4.7 Error Handling

Backend commands return classified messages:

- `wayland screencast portal is unavailable`
- `wayland screencast permission was denied`
- `no matching monitor stream was returned`
- `pipewire stream did not produce frames`
- `unsupported pipewire video format: <format>`

The frontend shows these messages in a compact toast near the screenshot toolbar and restores the committed selection.

### 4.8 Cleanup

`ScrollState` stores the frame source in addition to the stitcher and cancel flag. Dropping or taking the scroll state must:

- set the cancel flag,
- drop the `ScrollFrameSource`,
- stop the PipeWire loop,
- close the portal session,
- close the chrome window,
- restore overlay cursor handling for non-Wayland paths.

The cleanup path must be idempotent.

## 5. Testing

Rust unit tests cover:

- backend selection for Linux Wayland vs X11,
- stream selection from portal metadata,
- logical-to-raw crop mapping with fractional scale,
- RGBA conversion for `RGBA`, `RGBx`, `BGRA`, `BGRx`, `RGB`, and `BGR`,
- stride-aware row reads,
- latest-frame buffer timeout and latest-frame coalescing,
- source cleanup toggling the stop flag.

Frontend tests cover:

- failed `startScrollSession` displays a user-visible error,
- Wayland scroll start does not remain silent after backend rejection,
- existing committed selection is restored after failure.

Manual smoke tests cover GNOME Wayland, KDE Wayland, and one wlroots/Hyprland compositor:

- long web page in Chrome or Firefox,
- long PDF in a native reader or browser,
- chat scrollback.

## 6. Rollout Safety

The first implementation should keep the existing xcap code path intact and introduce the Wayland provider only through a backend factory. If the Wayland provider cannot initialize, it returns a clear unsupported error. It must not fall back to repeated screenshot portal capture because that path cannot deliver a stable 16fps scrolling feed.

## 7. References

- xdg-desktop-portal ScreenCast: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html
- PipeWire streams: https://docs.pipewire.org/page_streams.html
- Local ashpd API: `ashpd-0.8.1/src/desktop/screencast.rs`
- Local xcap PipeWire reference: `xcap-0.9.4/src/linux/wayland_video_recorder.rs`
