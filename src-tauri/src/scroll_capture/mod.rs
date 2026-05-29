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

pub(crate) async fn start_scroll_capture_session(
    monitor: &MonitorInfo,
    logical_rect: Rect,
    physical_rect: Rect,
) -> Result<ScrollCaptureSession> {
    let backend = select_backend_for_session(cfg!(target_os = "linux"), is_wayland_session());
    match backend {
        ScrollCaptureBackend::Xcap => {
            let _ = logical_rect;
            let source = xcap_source::XcapScrollCapture::new(monitor.id, physical_rect)?;
            source.into_session(Duration::from_millis(100))
        }
        ScrollCaptureBackend::WaylandPortal => {
            #[cfg(target_os = "linux")]
            {
                start_wayland_scroll_capture_session(monitor, logical_rect).await
            }
            #[cfg(not(target_os = "linux"))]
            {
                unreachable!("wayland portal backend is only selected on linux")
            }
        }
    }
}

mod xcap_source;

#[cfg(target_os = "linux")]
async fn start_wayland_scroll_capture_session(
    monitor: &MonitorInfo,
    logical_rect: Rect,
) -> Result<ScrollCaptureSession> {
    let mut settings = crate::settings_store::load().unwrap_or_default();
    let mut portal =
        portal::start_monitor_screencast(settings.wayland_screencast_restore_token.clone()).await?;
    if portal.restore_token != settings.wayland_screencast_restore_token {
        settings.wayland_screencast_restore_token = portal.restore_token.clone();
        if let Err(e) = crate::settings_store::save(&settings) {
            tracing::warn!("failed to save wayland screencast restore token: {e}");
        }
    }

    let stream = mapping::choose_monitor_stream(&portal.streams, monitor.rect)
        .ok_or_else(|| anyhow::anyhow!("no matching monitor stream was returned"))?;
    let remote_fd = portal.take_remote_fd()?;
    let (source, initial) = pipewire_source::WaylandPipeWireSource::spawn(
        remote_fd,
        stream,
        None,
        monitor.rect,
        logical_rect,
    )?;
    Ok(ScrollCaptureSession {
        width: initial.width,
        height: initial.height,
        initial_frame: initial.rgba,
        source: Box::new(WaylandPortalFrameSource {
            source,
            _portal: portal,
        }),
    })
}

#[cfg(target_os = "linux")]
struct WaylandPortalFrameSource {
    source: pipewire_source::WaylandPipeWireSource,
    _portal: portal::PortalScreenCastSession,
}

#[cfg(target_os = "linux")]
impl ScrollFrameSource for WaylandPortalFrameSource {
    fn next_frame(&mut self, timeout: Duration) -> Result<Vec<u8>> {
        self.source.next_frame(timeout)
    }
}

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

    #[test]
    fn factory_has_linux_wayland_portal_branch() {
        let source = include_str!("mod.rs").replace("\r\n", "\n");
        let factory = source
            .split("#[cfg(test)]")
            .next()
            .expect("scroll capture source should contain production section");

        assert!(factory.contains("is_wayland_session"));
        assert!(factory.contains("start_monitor_screencast"));
        assert!(factory.contains("WaylandPipeWireSource"));
        assert!(factory.contains("restore_token"));
    }
}
