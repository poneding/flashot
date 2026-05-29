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
