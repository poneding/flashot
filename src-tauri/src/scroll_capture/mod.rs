use crate::types::{MonitorInfo, Rect};
use anyhow::Result;
use std::time::Duration;

pub(crate) mod frame_buffer;
pub(crate) mod mapping;
#[cfg(target_os = "linux")]
pub(crate) mod pipewire_source;
#[cfg(target_os = "linux")]
pub(crate) mod portal;

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
    source.into_session(Duration::from_millis(100))
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
        assert_eq!(
            select_backend_for_session(true, false),
            ScrollCaptureBackend::Xcap
        );
        assert_eq!(
            select_backend_for_session(false, true),
            ScrollCaptureBackend::Xcap
        );
    }
}
