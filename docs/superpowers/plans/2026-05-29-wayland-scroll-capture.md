# Wayland Scroll Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Wayland scrolling screenshot support through xdg-desktop-portal ScreenCast and PipeWire without changing existing macOS, Windows, or Linux X11 behavior.

**Architecture:** Introduce a backend-neutral `scroll_capture` module. Existing xcap capture becomes one `ScrollFrameSource`; Linux Wayland gets a separate portal/PipeWire source that emits cropped RGBA frames into the existing `ScrollStitcher`.

**Tech Stack:** Rust, Tauri 2, `ashpd 0.8.1`, `pipewire 0.9.2`, `tokio`, React, Vitest.

---

## File Structure

- Create `src-tauri/src/scroll_capture/mod.rs`: provider factory, `ScrollCaptureSession`, `ScrollFrameSource`, backend selection.
- Create `src-tauri/src/scroll_capture/xcap_source.rs`: current xcap monitor-region capture wrapped as a frame source.
- Create `src-tauri/src/scroll_capture/mapping.rs`: pure stream selection and crop-mapping helpers.
- Create `src-tauri/src/scroll_capture/frame_buffer.rs`: latest-frame buffer shared by the PipeWire thread and scroll loop.
- Create `src-tauri/src/scroll_capture/pipewire_source.rs`: Linux-only PipeWire consumer and RGBA conversion helpers.
- Create `src-tauri/src/scroll_capture/portal.rs`: Linux-only ScreenCast portal session wrapper.
- Modify `src-tauri/src/lib.rs`: register `scroll_capture`.
- Modify `src-tauri/src/commands.rs`: create scroll capture sessions through the factory and surface classified errors.
- Modify `src-tauri/src/scroll_session.rs`: read frames from a `ScrollFrameSource` instead of hard-coded `capture_monitor_region`.
- Modify `src-tauri/src/window_mgr.rs`: store/drop the active frame source with `ScrollState`.
- Modify `src/routes/Overlay.tsx`: show start-scroll errors and restore the committed selection.
- Modify `src/lib/types.ts`: add a typed scroll-start error payload only if an event is needed; prefer command rejection first.
- Modify `src/__tests__/overlay-route.test.tsx`: cover visible scroll-start failure.
- Modify `docs/smoke-matrix.md`: add Wayland smoke matrix rows.

## Task 1: Register the Scroll Capture Module

**Files:**
- Create: `src-tauri/src/scroll_capture/mod.rs`
- Create: `src-tauri/src/scroll_capture/xcap_source.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing module-selection test**

Add this to `src-tauri/src/scroll_capture/mod.rs`:

```rust
use crate::types::{MonitorInfo, Rect};
use anyhow::Result;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScrollCaptureBackend {
    Xcap,
    WaylandPortal,
}

pub(crate) struct ScrollCaptureSession {
    pub initial_frame: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source: Box<dyn ScrollFrameSource>,
}

pub(crate) trait ScrollFrameSource: Send {
    fn next_frame(&mut self, timeout: Duration) -> Result<Vec<u8>>;
}

pub(crate) fn select_backend_for_session(is_linux: bool, is_wayland: bool) -> ScrollCaptureBackend {
    if is_linux && is_wayland {
        ScrollCaptureBackend::WaylandPortal
    } else {
        ScrollCaptureBackend::Xcap
    }
}

pub(crate) fn start_scroll_capture_session(
    monitor: &MonitorInfo,
    logical_rect: Rect,
    physical_rect: Rect,
) -> Result<ScrollCaptureSession> {
    let _ = logical_rect;
    let source = xcap_source::XcapScrollCapture::new(monitor.id, physical_rect)?;
    Ok(source.into_session(Duration::from_millis(100))?)
}

mod xcap_source;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_wayland_selects_portal_backend() {
        assert_eq!(
            select_backend_for_session(true, true),
            ScrollCaptureBackend::WaylandPortal
        );
    }

    #[test]
    fn non_wayland_selects_xcap_backend() {
        assert_eq!(select_backend_for_session(true, false), ScrollCaptureBackend::Xcap);
        assert_eq!(select_backend_for_session(false, true), ScrollCaptureBackend::Xcap);
    }
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd src-tauri && cargo test scroll_capture::tests::linux_wayland_selects_portal_backend
```

Expected: compile failure because `scroll_capture` is not registered and `xcap_source` does not exist.

- [ ] **Step 3: Add the xcap source wrapper**

Create `src-tauri/src/scroll_capture/xcap_source.rs`:

```rust
use super::{ScrollCaptureSession, ScrollFrameSource};
use crate::capture::capture_monitor_region;
use crate::types::Rect;
use anyhow::Result;
use std::time::Duration;

pub(crate) struct XcapScrollCapture {
    monitor_id: u32,
    rect: Rect,
}

impl XcapScrollCapture {
    pub(crate) fn new(monitor_id: u32, rect: Rect) -> Result<Self> {
        Ok(Self { monitor_id, rect })
    }

    pub(crate) fn into_session(mut self, timeout: Duration) -> Result<ScrollCaptureSession> {
        let initial_frame = self.next_frame(timeout)?;
        Ok(ScrollCaptureSession {
            width: self.rect.width,
            height: self.rect.height,
            initial_frame,
            source: Box::new(self),
        })
    }
}

impl ScrollFrameSource for XcapScrollCapture {
    fn next_frame(&mut self, _timeout: Duration) -> Result<Vec<u8>> {
        capture_monitor_region(self.monitor_id, self.rect)
    }
}
```

- [ ] **Step 4: Register the module**

Add to `src-tauri/src/lib.rs` near the existing module declarations:

```rust
pub mod scroll_capture;
```

- [ ] **Step 5: Run the module tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::tests
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/scroll_capture
git commit -m "feat(scroll): add scroll capture provider boundary"
```

## Task 2: Move the Scroll Loop to a Frame Source

**Files:**
- Modify: `src-tauri/src/scroll_session.rs`
- Modify: `src-tauri/src/window_mgr.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write a source-level regression test**

Add this test to `src-tauri/src/scroll_session.rs`:

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn scroll_loop_uses_frame_source_instead_of_capture_monitor_region() {
        let source = include_str!("scroll_session.rs").replace("\r\n", "\n");
        let body_start = source.find("pub fn spawn_loop").unwrap();
        let body_end = source[body_start..]
            .find("fn base64_encode")
            .map(|idx| body_start + idx)
            .unwrap();
        let body = &source[body_start..body_end];

        assert!(body.contains("ScrollFrameSource"));
        assert!(body.contains("next_frame"));
        assert!(!body.contains("capture_monitor_region"));
    }
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd src-tauri && cargo test scroll_session::tests::scroll_loop_uses_frame_source_instead_of_capture_monitor_region
```

Expected: fail because the loop still imports and calls `capture_monitor_region`.

- [ ] **Step 3: Update `ScrollState`**

In `src-tauri/src/window_mgr.rs`, import the source trait:

```rust
use crate::scroll_capture::ScrollFrameSource;
```

Change `ScrollState`:

```rust
pub(crate) struct ScrollState {
    pub monitor_id: u32,
    pub rect: crate::types::Rect,
    pub stitcher: Arc<tokio::sync::Mutex<ScrollStitcher>>,
    pub source: Arc<tokio::sync::Mutex<Box<dyn ScrollFrameSource>>>,
    pub cancel: Arc<std::sync::atomic::AtomicBool>,
}
```

- [ ] **Step 4: Update `spawn_loop` signature and frame capture**

In `src-tauri/src/scroll_session.rs`, remove:

```rust
use crate::capture::capture_monitor_region;
use crate::types::Rect;
```

Add:

```rust
use crate::scroll_capture::ScrollFrameSource;
```

Change `spawn_loop` signature:

```rust
pub fn spawn_loop(
    app: AppHandle,
    source: Arc<AsyncMutex<Box<dyn ScrollFrameSource>>>,
    stitcher: Arc<AsyncMutex<ScrollStitcher>>,
    cancel: Arc<AtomicBool>,
)
```

Replace the hard-coded capture block with:

```rust
let frame = {
    let mut source = source.lock().await;
    match source.next_frame(Duration::from_millis(TICK_MS * 3)) {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!("scroll capture failed: {e}");
            continue;
        }
    }
};
```

- [ ] **Step 5: Update `start_scroll_session`**

In `src-tauri/src/commands.rs`, replace the direct initial capture with:

```rust
let monitor = crate::capture::enumerate_monitors()
    .map_err(|e| format!("failed to enumerate monitors for scroll capture: {e}"))?
    .into_iter()
    .find(|m| m.id == monitor_id)
    .ok_or("monitor not found for scroll capture")?;

let capture = match crate::scroll_capture::start_scroll_capture_session(&monitor, rect, phys_rect) {
    Ok(capture) => capture,
    Err(e) => {
        close_scroll_chrome(&app, monitor_id);
        return Err(format!("scroll capture unavailable: {e}"));
    }
};

let stitcher = Arc::new(AsyncMutex::new(ScrollStitcher::new(
    capture.width,
    capture.height,
    capture.initial_frame,
    StitchConfig::default(),
)));
let source = Arc::new(AsyncMutex::new(capture.source));
```

Update the `spawn_loop` call:

```rust
crate::scroll_session::spawn_loop(app.clone(), source.clone(), stitcher.clone(), cancel.clone());
```

Store `source` in `ScrollState`.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
cd src-tauri && cargo test scroll_session::tests::scroll_loop_uses_frame_source_instead_of_capture_monitor_region
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scroll_session.rs src-tauri/src/window_mgr.rs src-tauri/src/commands.rs
git commit -m "refactor(scroll): route capture loop through frame source"
```

## Task 3: Add Pure Wayland Stream Mapping

**Files:**
- Create: `src-tauri/src/scroll_capture/mapping.rs`
- Modify: `src-tauri/src/scroll_capture/mod.rs`

- [ ] **Step 1: Write mapping tests**

Create `src-tauri/src/scroll_capture/mapping.rs`:

```rust
use crate::types::Rect;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PortalStreamInfo {
    pub node_id: u32,
    pub position: Option<(i32, i32)>,
    pub size: Option<(i32, i32)>,
    pub source_type_monitor: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RawFrameSize {
    pub width: u32,
    pub height: u32,
}

pub(crate) fn choose_monitor_stream(
    streams: &[PortalStreamInfo],
    monitor_rect: Rect,
) -> Option<PortalStreamInfo> {
    streams
        .iter()
        .filter(|s| s.source_type_monitor)
        .find(|s| stream_contains_monitor_center(s, monitor_rect))
        .cloned()
        .or_else(|| {
            streams
                .iter()
                .filter(|s| s.source_type_monitor)
                .find(|s| stream_matches_monitor_bounds(s, monitor_rect))
                .cloned()
        })
        .or_else(|| {
            let monitor_streams: Vec<_> = streams.iter().filter(|s| s.source_type_monitor).collect();
            (monitor_streams.len() == 1).then(|| monitor_streams[0].clone())
        })
}

fn stream_contains_monitor_center(stream: &PortalStreamInfo, monitor_rect: Rect) -> bool {
    let Some((sx, sy)) = stream.position else { return false; };
    let Some((sw, sh)) = stream.size else { return false; };
    let cx = monitor_rect.x + monitor_rect.width as i32 / 2;
    let cy = monitor_rect.y + monitor_rect.height as i32 / 2;
    cx >= sx && cy >= sy && cx < sx + sw && cy < sy + sh
}

fn stream_matches_monitor_bounds(stream: &PortalStreamInfo, monitor_rect: Rect) -> bool {
    stream.position == Some((monitor_rect.x, monitor_rect.y))
        && stream.size == Some((monitor_rect.width as i32, monitor_rect.height as i32))
}

pub(crate) fn map_logical_selection_to_raw_crop(
    stream: &PortalStreamInfo,
    raw: RawFrameSize,
    monitor_rect: Rect,
    selection: Rect,
) -> anyhow::Result<Rect> {
    let (sx, sy) = stream.position.unwrap_or((monitor_rect.x, monitor_rect.y));
    let (logical_w, logical_h) = stream
        .size
        .unwrap_or((monitor_rect.width as i32, monitor_rect.height as i32));
    if logical_w <= 0 || logical_h <= 0 {
        anyhow::bail!("portal stream has invalid logical size");
    }

    let scale_x = raw.width as f32 / logical_w as f32;
    let scale_y = raw.height as f32 / logical_h as f32;
    let x = ((monitor_rect.x + selection.x - sx) as f32 * scale_x).round() as i32;
    let y = ((monitor_rect.y + selection.y - sy) as f32 * scale_y).round() as i32;
    let width = (selection.width as f32 * scale_x).round().max(1.0) as u32;
    let height = (selection.height as f32 * scale_y).round().max(1.0) as u32;

    Ok(clamp_rect_to_raw(Rect { x, y, width, height }, raw))
}

fn clamp_rect_to_raw(rect: Rect, raw: RawFrameSize) -> Rect {
    let width = rect.width.min(raw.width);
    let height = rect.height.min(raw.height);
    let max_x = raw.width.saturating_sub(width) as i32;
    let max_y = raw.height.saturating_sub(height) as i32;
    Rect {
        x: rect.x.clamp(0, max_x),
        y: rect.y.clamp(0, max_y),
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_stream_containing_monitor_center() {
        let streams = vec![
            PortalStreamInfo {
                node_id: 1,
                position: Some((0, 0)),
                size: Some((1920, 1080)),
                source_type_monitor: true,
            },
            PortalStreamInfo {
                node_id: 2,
                position: Some((1920, 0)),
                size: Some((2560, 1440)),
                source_type_monitor: true,
            },
        ];

        let chosen = choose_monitor_stream(
            &streams,
            Rect { x: 1920, y: 0, width: 2560, height: 1440 },
        )
        .unwrap();

        assert_eq!(chosen.node_id, 2);
    }

    #[test]
    fn maps_fractional_scale_selection_to_raw_crop() {
        let stream = PortalStreamInfo {
            node_id: 7,
            position: Some((0, 0)),
            size: Some((1600, 900)),
            source_type_monitor: true,
        };

        let crop = map_logical_selection_to_raw_crop(
            &stream,
            RawFrameSize { width: 2400, height: 1350 },
            Rect { x: 0, y: 0, width: 1600, height: 900 },
            Rect { x: 100, y: 50, width: 300, height: 200 },
        )
        .unwrap();

        assert_eq!(crop, Rect { x: 150, y: 75, width: 450, height: 300 });
    }
}
```

- [ ] **Step 2: Register the module**

Add to `src-tauri/src/scroll_capture/mod.rs`:

```rust
pub(crate) mod mapping;
```

- [ ] **Step 3: Run mapping tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::mapping::tests
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scroll_capture/mod.rs src-tauri/src/scroll_capture/mapping.rs
git commit -m "feat(scroll): map portal streams to monitor selections"
```

## Task 4: Add Latest Frame Buffer

**Files:**
- Create: `src-tauri/src/scroll_capture/frame_buffer.rs`
- Modify: `src-tauri/src/scroll_capture/mod.rs`

- [ ] **Step 1: Add the buffer with tests**

Create `src-tauri/src/scroll_capture/frame_buffer.rs`:

```rust
use anyhow::{bail, Result};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CapturedFrame {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
pub(crate) struct LatestFrameBuffer {
    inner: Mutex<Inner>,
    changed: Condvar,
}

#[derive(Default)]
struct Inner {
    seq: u64,
    frame: Option<CapturedFrame>,
    stopped: bool,
}

impl LatestFrameBuffer {
    pub(crate) fn publish(&self, frame: CapturedFrame) {
        let mut inner = self.inner.lock().unwrap();
        inner.seq += 1;
        inner.frame = Some(frame);
        self.changed.notify_all();
    }

    pub(crate) fn stop(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.stopped = true;
        self.changed.notify_all();
    }

    pub(crate) fn wait_next(&self, last_seq: &mut u64, timeout: Duration) -> Result<CapturedFrame> {
        let deadline = Instant::now() + timeout;
        let mut inner = self.inner.lock().unwrap();
        loop {
            if inner.seq > *last_seq {
                *last_seq = inner.seq;
                return inner.frame.clone().ok_or_else(|| anyhow::anyhow!("frame missing"));
            }
            if inner.stopped {
                bail!("scroll capture source stopped");
            }
            let now = Instant::now();
            if now >= deadline {
                bail!("timed out waiting for pipewire frame");
            }
            let wait = deadline - now;
            let (next, _) = self.changed.wait_timeout(inner, wait).unwrap();
            inner = next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_next_returns_latest_published_frame() {
        let buffer = LatestFrameBuffer::default();
        buffer.publish(CapturedFrame { rgba: vec![1, 2, 3], width: 1, height: 1 });
        buffer.publish(CapturedFrame { rgba: vec![4, 5, 6], width: 1, height: 1 });
        let mut seq = 0;

        let frame = buffer.wait_next(&mut seq, Duration::from_millis(10)).unwrap();

        assert_eq!(frame.rgba, vec![4, 5, 6]);
        assert_eq!(seq, 2);
    }

    #[test]
    fn wait_next_times_out_without_frame() {
        let buffer = LatestFrameBuffer::default();
        let mut seq = 0;

        let err = buffer
            .wait_next(&mut seq, Duration::from_millis(1))
            .expect_err("empty buffer should time out");

        assert!(err.to_string().contains("timed out"));
    }
}
```

- [ ] **Step 2: Register the module**

Add to `src-tauri/src/scroll_capture/mod.rs`:

```rust
pub(crate) mod frame_buffer;
```

- [ ] **Step 3: Run buffer tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::frame_buffer::tests
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scroll_capture/mod.rs src-tauri/src/scroll_capture/frame_buffer.rs
git commit -m "feat(scroll): add latest frame buffer"
```

## Task 5: Add PipeWire Format Conversion Helpers

**Files:**
- Create: `src-tauri/src/scroll_capture/pipewire_source.rs`
- Modify: `src-tauri/src/scroll_capture/mod.rs`

- [ ] **Step 1: Write conversion tests and helpers**

Create `src-tauri/src/scroll_capture/pipewire_source.rs`:

```rust
use crate::types::Rect;
use anyhow::{bail, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RawVideoFormat {
    Rgba,
    Rgbx,
    Bgra,
    Bgrx,
    Rgb,
    Bgr,
}

pub(crate) fn convert_raw_frame_to_rgba(
    data: &[u8],
    width: u32,
    height: u32,
    stride: usize,
    format: RawVideoFormat,
) -> Result<Vec<u8>> {
    let bytes_per_pixel = match format {
        RawVideoFormat::Rgb | RawVideoFormat::Bgr => 3,
        _ => 4,
    };
    let min_stride = width as usize * bytes_per_pixel;
    if stride < min_stride {
        bail!("pipewire stride is smaller than the video row");
    }
    if data.len() < stride * height as usize {
        bail!("pipewire buffer is smaller than the declared frame");
    }

    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for row in 0..height as usize {
        let row_data = &data[row * stride..row * stride + min_stride];
        for px in row_data.chunks_exact(bytes_per_pixel) {
            match format {
                RawVideoFormat::Rgba | RawVideoFormat::Rgbx => {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
                RawVideoFormat::Bgra | RawVideoFormat::Bgrx => {
                    out.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
                RawVideoFormat::Rgb => {
                    out.extend_from_slice(&[px[0], px[1], px[2], 255]);
                }
                RawVideoFormat::Bgr => {
                    out.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
            }
        }
    }
    Ok(out)
}

pub(crate) fn crop_rgba_frame(rgba: &[u8], frame_width: u32, crop: Rect) -> Result<Vec<u8>> {
    if crop.x < 0 || crop.y < 0 {
        bail!("crop origin must be non-negative");
    }
    let row_bytes = crop.width as usize * 4;
    let mut out = Vec::with_capacity(row_bytes * crop.height as usize);
    for row in 0..crop.height {
        let y = crop.y as u32 + row;
        let start = (y * frame_width + crop.x as u32) as usize * 4;
        let end = start + row_bytes;
        let slice = rgba
            .get(start..end)
            .ok_or_else(|| anyhow::anyhow!("crop row is out of bounds"))?;
        out.extend_from_slice(slice);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_bgrx_with_stride_to_rgba() {
        let data = vec![
            10, 20, 30, 0, 40, 50, 60, 0, 99, 99, 99, 99,
            70, 80, 90, 0, 100, 110, 120, 0, 88, 88, 88, 88,
        ];

        let rgba = convert_raw_frame_to_rgba(&data, 2, 2, 12, RawVideoFormat::Bgrx).unwrap();

        assert_eq!(
            rgba,
            vec![
                30, 20, 10, 255, 60, 50, 40, 255,
                90, 80, 70, 255, 120, 110, 100, 255,
            ]
        );
    }

    #[test]
    fn crops_rgba_frame_rows() {
        let rgba = (0_u8..48).collect::<Vec<_>>();

        let crop = crop_rgba_frame(
            &rgba,
            4,
            Rect { x: 1, y: 1, width: 2, height: 1 },
        )
        .unwrap();

        assert_eq!(crop, vec![20, 21, 22, 23, 24, 25, 26, 27]);
    }
}
```

- [ ] **Step 2: Register the module on Linux**

Add to `src-tauri/src/scroll_capture/mod.rs`:

```rust
#[cfg(target_os = "linux")]
pub(crate) mod pipewire_source;
```

- [ ] **Step 3: Run conversion tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::pipewire_source::tests
```

Expected: pass on Linux.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scroll_capture/mod.rs src-tauri/src/scroll_capture/pipewire_source.rs
git commit -m "feat(scroll): convert pipewire frames to rgba"
```

## Task 6: Add the Portal Session Wrapper

**Files:**
- Create: `src-tauri/src/scroll_capture/portal.rs`
- Modify: `src-tauri/src/scroll_capture/mod.rs`

- [ ] **Step 1: Add a source-level API test**

Create `src-tauri/src/scroll_capture/portal.rs`:

```rust
#[cfg(target_os = "linux")]
mod linux {
    use super::super::mapping::PortalStreamInfo;
    use anyhow::{Context, Result};
    use ashpd::{
        desktop::{
            screencast::{CursorMode, PersistMode, Screencast, SourceType},
            Session,
        },
        WindowIdentifier,
    };
    use enumflags2::BitFlags;
    use std::os::fd::OwnedFd;

    pub(crate) struct PortalScreenCastSession {
        pub streams: Vec<PortalStreamInfo>,
        pub remote_fd: OwnedFd,
        pub restore_token: Option<String>,
        _screencast: Screencast<'static>,
        _session: Session<'static>,
    }

    pub(crate) async fn start_monitor_screencast(
        restore_token: Option<String>,
    ) -> Result<PortalScreenCastSession> {
        let proxy: Screencast<'static> = Screencast::new()
            .await
            .context("wayland screencast portal is unavailable")?;
        let session = proxy
            .create_session()
            .await
            .context("failed to create wayland screencast session")?;
        proxy
            .select_sources(
                &session,
                CursorMode::Hidden,
                BitFlags::from(SourceType::Monitor),
                true,
                restore_token.as_deref(),
                PersistMode::ExplicitlyRevoked,
            )
            .await
            .context("failed to select wayland screencast sources")?
            .response()
            .context("wayland screencast permission was denied")?;
        let response = proxy
            .start(&session, &WindowIdentifier::default())
            .await
            .context("failed to start wayland screencast")?
            .response()
            .context("wayland screencast permission was denied")?;
        let streams = response
            .streams()
            .iter()
            .map(|s| PortalStreamInfo {
                node_id: s.pipe_wire_node_id(),
                position: s.position(),
                size: s.size(),
                source_type_monitor: s.source_type() == Some(SourceType::Monitor),
            })
            .collect::<Vec<_>>();
        let remote_fd = proxy
            .open_pipe_wire_remote(&session)
            .await
            .context("failed to open pipewire remote for wayland screencast")?;
        Ok(PortalScreenCastSession {
            streams,
            remote_fd,
            restore_token: response.restore_token().map(str::to_string),
            _screencast: proxy,
            _session: session,
        })
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn portal_wrapper_uses_monitor_screencast() {
            let source = include_str!("portal.rs");
            assert!(source.contains("SourceType::Monitor"));
            assert!(source.contains("CursorMode::Hidden"));
            assert!(source.contains("open_pipe_wire_remote"));
            assert!(source.contains("restore_token"));
        }
    }
}

#[cfg(target_os = "linux")]
pub(crate) use linux::*;
```

- [ ] **Step 2: Register the module**

Add to `src-tauri/src/scroll_capture/mod.rs`:

```rust
#[cfg(target_os = "linux")]
pub(crate) mod portal;
```

- [ ] **Step 3: Run the portal API test**

Run:

```bash
cd src-tauri && cargo test scroll_capture::portal::linux::tests::portal_wrapper_uses_monitor_screencast
```

Expected: pass. `PortalScreenCastSession` owns both `Screencast<'static>` and `Session<'static>` so the portal session remains alive while the PipeWire source is active.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scroll_capture/mod.rs src-tauri/src/scroll_capture/portal.rs
git commit -m "feat(scroll): add wayland screencast portal wrapper"
```

## Task 7: Build the Wayland PipeWire Source

**Files:**
- Modify: `src-tauri/src/scroll_capture/pipewire_source.rs`
- Modify: `src-tauri/src/scroll_capture/mod.rs`

- [ ] **Step 1: Add a lifecycle source-level test**

Append to `pipewire_source.rs` tests:

```rust
#[test]
fn wayland_source_drop_stops_latest_frame_buffer() {
    let source = include_str!("pipewire_source.rs");
    assert!(source.contains("impl Drop for WaylandPipeWireSource"));
    assert!(source.contains("LatestFrameBuffer"));
    assert!(source.contains("buffer.stop()"));
}
```

- [ ] **Step 2: Run and verify it fails**

Run:

```bash
cd src-tauri && cargo test scroll_capture::pipewire_source::tests::wayland_source_drop_stops_latest_frame_buffer
```

Expected: fail because `WaylandPipeWireSource` does not exist.

- [ ] **Step 3: Add the Wayland source shell**

Add to `src-tauri/src/scroll_capture/pipewire_source.rs` above tests:

```rust
use super::frame_buffer::{CapturedFrame, LatestFrameBuffer};
use super::mapping::{map_logical_selection_to_raw_crop, PortalStreamInfo, RawFrameSize};
use super::ScrollFrameSource;
use std::os::fd::OwnedFd;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::JoinHandle;
use std::time::Duration;

pub(crate) struct WaylandPipeWireSource {
    buffer: Arc<LatestFrameBuffer>,
    stop: Arc<AtomicBool>,
    last_seq: u64,
    join: Option<JoinHandle<()>>,
}

impl WaylandPipeWireSource {
    pub(crate) fn spawn(
        remote_fd: OwnedFd,
        stream: PortalStreamInfo,
        raw_size_hint: Option<RawFrameSize>,
        monitor_rect: crate::types::Rect,
        logical_selection: crate::types::Rect,
    ) -> anyhow::Result<(Self, CapturedFrame)> {
        let buffer = Arc::new(LatestFrameBuffer::default());
        let stop = Arc::new(AtomicBool::new(false));
        let thread_buffer = buffer.clone();
        let thread_stop = stop.clone();

        let join = std::thread::spawn(move || {
            if let Err(e) = run_pipewire_loop(
                remote_fd,
                stream,
                raw_size_hint,
                monitor_rect,
                logical_selection,
                thread_buffer.clone(),
                thread_stop.clone(),
            ) {
                tracing::warn!("wayland pipewire scroll capture stopped: {e}");
                thread_buffer.stop();
            }
        });

        let mut source = Self {
            buffer,
            stop,
            last_seq: 0,
            join: Some(join),
        };
        let initial = source.buffer.wait_next(&mut source.last_seq, Duration::from_secs(3))?;
        if initial.rgba.is_empty() || initial.width == 0 || initial.height == 0 {
            anyhow::bail!("pipewire stream produced an empty frame");
        }
        Ok((source, initial))
    }
}

impl ScrollFrameSource for WaylandPipeWireSource {
    fn next_frame(&mut self, timeout: Duration) -> anyhow::Result<Vec<u8>> {
        Ok(self.buffer.wait_next(&mut self.last_seq, timeout)?.rgba)
    }
}

impl Drop for WaylandPipeWireSource {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.buffer.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn run_pipewire_loop(
    _remote_fd: OwnedFd,
    _stream: PortalStreamInfo,
    _raw_size_hint: Option<RawFrameSize>,
    _monitor_rect: crate::types::Rect,
    _logical_selection: crate::types::Rect,
    _buffer: Arc<LatestFrameBuffer>,
    _stop: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    anyhow::bail!("pipewire loop is not connected")
}
```

- [ ] **Step 4: Replace `run_pipewire_loop` with a real PipeWire consumer**

Use the local xcap reference in `~/.cargo/registry/src/.../xcap-0.9.4/src/linux/wayland_video_recorder.rs` as the pattern:

- call `pipewire::init()`,
- create `MainLoopRc`, `ContextRc`, and connect to the portal remote fd,
- create `StreamRc` with video capture properties,
- negotiate raw formats listed in the design,
- in `process`, read `datas[0].data()`, format, width, height, and stride,
- call `convert_raw_frame_to_rgba`,
- compute the crop with `map_logical_selection_to_raw_crop`,
- call `crop_rgba_frame`,
- publish the crop into `LatestFrameBuffer` as `CapturedFrame { rgba, width: crop.width, height: crop.height }`,
- exit the loop when `stop` is set.

Keep all unsupported formats as warnings and continue waiting for a supported format.

- [ ] **Step 5: Run conversion and lifecycle tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::pipewire_source::tests
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/scroll_capture/pipewire_source.rs
git commit -m "feat(scroll): add wayland pipewire frame source"
```

## Task 8: Wire Wayland Provider Selection

**Files:**
- Modify: `src-tauri/src/scroll_capture/mod.rs`
- Modify: `src-tauri/src/settings_store.rs`

- [ ] **Step 1: Add a source-level Wayland factory test**

Append to `src-tauri/src/scroll_capture/mod.rs` tests:

```rust
#[test]
fn factory_has_linux_wayland_portal_branch() {
    let source = include_str!("mod.rs");
    assert!(source.contains("is_wayland_session"));
    assert!(source.contains("start_monitor_screencast"));
    assert!(source.contains("WaylandPipeWireSource"));
    assert!(source.contains("restore_token"));
}
```

- [ ] **Step 2: Run and verify it fails**

Run:

```bash
cd src-tauri && cargo test scroll_capture::tests::factory_has_linux_wayland_portal_branch
```

Expected: fail because the factory still always returns xcap.

- [ ] **Step 3: Add settings fields for restore token**

In `src-tauri/src/settings_store.rs`, add to `Settings`:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub wayland_screencast_restore_token: Option<String>,
```

Update `Default` and serialization tests to include `None` as the default and verify old settings files still deserialize.

- [ ] **Step 4: Add the Linux Wayland branch**

In `src-tauri/src/scroll_capture/mod.rs`, implement:

```rust
#[cfg(target_os = "linux")]
fn is_wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE")
        .map(|session| session.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[cfg(not(target_os = "linux"))]
fn is_wayland_session() -> bool {
    false
}
```

Then in `start_scroll_capture_session`, branch:

```rust
#[cfg(target_os = "linux")]
if is_wayland_session() {
    let mut settings = crate::settings_store::load().unwrap_or_default();
    let portal = portal::start_monitor_screencast(
        settings.wayland_screencast_restore_token.clone(),
    )
    .await?;
    if portal.restore_token != settings.wayland_screencast_restore_token {
        settings.wayland_screencast_restore_token = portal.restore_token.clone();
        let _ = crate::settings_store::save(&settings);
    }
    let stream = mapping::choose_monitor_stream(&portal.streams, monitor.rect)
        .ok_or_else(|| anyhow::anyhow!("no matching monitor stream was returned"))?;
    let (source, initial) = pipewire_source::WaylandPipeWireSource::spawn(
        portal.remote_fd,
        stream,
        None,
        monitor.rect,
        logical_rect,
    )?;
    return Ok(ScrollCaptureSession {
        width: initial.width,
        height: initial.height,
        initial_frame: initial.rgba,
        source: Box::new(source),
    });
}
```

Because portal startup is async, change `start_scroll_capture_session` to `async fn` and update the xcap branch to return synchronously inside the async function.

- [ ] **Step 5: Update `commands.rs` to await the factory**

Change:

```rust
crate::scroll_capture::start_scroll_capture_session(&monitor, rect, phys_rect)
```

to:

```rust
crate::scroll_capture::start_scroll_capture_session(&monitor, rect, phys_rect).await
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
cd src-tauri && cargo test scroll_capture::tests settings_store::tests
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/scroll_capture/mod.rs src-tauri/src/settings_store.rs src-tauri/src/commands.rs
git commit -m "feat(scroll): select wayland screencast backend"
```

## Task 9: Make Wayland Overlay Startup Non-Blocking to Input

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Add a backend source-level test**

Append to `commands.rs` tests:

```rust
#[test]
fn wayland_scroll_start_hides_overlay_only_after_capture_starts() {
    let source = include_str!("commands.rs").replace("\r\n", "\n");
    let body = function_body(&source, "start_scroll_session");
    let factory_idx = body.find("start_scroll_capture_session").unwrap();
    let hide_idx = body.find("hide_wayland_scroll_overlay").unwrap();
    assert!(factory_idx < hide_idx);
}
```

- [ ] **Step 2: Run and verify it fails**

Run:

```bash
cd src-tauri && cargo test commands::tests::wayland_scroll_start_hides_overlay_only_after_capture_starts
```

Expected: fail because `hide_wayland_scroll_overlay` does not exist.

- [ ] **Step 3: Add Wayland-only overlay hiding**

In `commands.rs`, add:

```rust
fn hide_wayland_scroll_overlay(app: &AppHandle, monitor_id: u32) {
    #[cfg(target_os = "linux")]
    if std::env::var("XDG_SESSION_TYPE")
        .map(|session| session.eq_ignore_ascii_case("wayland"))
        .unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
    {
        if let Some(w) = app.get_webview_window(&format!("overlay-{monitor_id}")) {
            let _ = w.hide();
        }
    }
}
```

Call it after the scroll capture session is created and before `spawn_loop`.

- [ ] **Step 4: Add frontend error state**

In `src/routes/Overlay.tsx`, add:

```tsx
const [scrollError, setScrollError] = useState<string | null>(null);
```

In `handleScroll` catch:

```tsx
const message = error instanceof Error ? error.message : String(error);
setScrollError(message);
window.setTimeout(() => setScrollError(null), 3600);
useOverlay.getState().commit(scrollSelection);
```

Render a compact toast near the existing toolbar area when `scrollError` is set.

- [ ] **Step 5: Add frontend test**

In `src/__tests__/overlay-route.test.tsx`, add a test that mocks `startScrollSession` rejection, clicks the scroll toolbar button, and asserts the error text is visible and the selection toolbar returns.

- [ ] **Step 6: Run frontend test**

Run:

```bash
pnpm test -- overlay-route.test.tsx
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs src/routes/Overlay.tsx src/__tests__/overlay-route.test.tsx
git commit -m "fix(scroll): surface wayland scroll startup failures"
```

## Task 10: Update Linux Packaging and CI Notes

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `docs/smoke-matrix.md`

- [ ] **Step 1: Make direct PipeWire dependencies explicit**

In `src-tauri/Cargo.toml`, under Linux dependencies, add direct dependencies already present in the lockfile:

```toml
pipewire = "0.9"
```

Keep `ashpd = "0.8"` unchanged unless compilation proves an API gap.

- [ ] **Step 2: Add runtime package notes**

In `src-tauri/tauri.conf.json`, Linux deb dependencies already include `libpipewire-0.3-0`. Keep it and do not add `libgtk-layer-shell0` as a hard dependency.

- [ ] **Step 3: Update smoke matrix**

Add a Wayland table to `docs/smoke-matrix.md`:

```markdown
## Scrolling Screenshot (Wayland)

| Target | GNOME Wayland | KDE Wayland | wlroots/Hyprland |
|---|---|---|---|
| Long web page | ⏳ pending | ⏳ pending | ⏳ pending |
| Long PDF | ⏳ pending | ⏳ pending | ⏳ pending |
| Chat scrollback | ⏳ pending | ⏳ pending | ⏳ pending |

Expected behavior: first use may show a system screen-sharing prompt. Denying permission must show a Flashot error toast and restore the committed selection.
```

- [ ] **Step 4: Run config tests**

Run:

```bash
pnpm test -- tauri-config.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json docs/smoke-matrix.md
git commit -m "docs: add wayland scroll capture smoke coverage"
```

## Task 11: Full Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm lint
```

Expected: pass.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: pass.

- [ ] **Step 4: Run Rust compile check**

Run:

```bash
cd src-tauri && cargo check
```

Expected: pass.

- [ ] **Step 5: Run clippy**

Run:

```bash
cd src-tauri && cargo clippy -- -D warnings
```

Expected: pass.

- [ ] **Step 6: Manual Wayland smoke test**

Run the app on each target compositor:

```bash
pnpm tauri dev
```

For each compositor, test:

- trigger capture,
- select a scrollable page region,
- click scrolling screenshot,
- approve portal prompt,
- scroll slowly,
- confirm preview height increases,
- click Done,
- Copy and paste the stitched image,
- Save and open the PNG.

- [ ] **Step 7: Commit smoke matrix updates**

After manual testing, update `docs/smoke-matrix.md` pass/fail cells and commit:

```bash
git add docs/smoke-matrix.md
git commit -m "test: record wayland scroll capture smoke results"
```

## Self-Review Checklist

- Every normal screenshot path remains outside the new provider factory.
- Existing macOS/Windows/X11 scroll behavior remains xcap-backed.
- Wayland failure paths return visible errors.
- PipeWire and portal resources are owned by `ScrollState` and dropped through session cleanup.
- Tests cover pure coordinate math and frame conversion before runtime integration.
