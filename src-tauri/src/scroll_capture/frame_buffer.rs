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
                return inner
                    .frame
                    .clone()
                    .ok_or_else(|| anyhow::anyhow!("frame missing"));
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
        buffer.publish(CapturedFrame {
            rgba: vec![1, 2, 3],
            width: 1,
            height: 1,
        });
        buffer.publish(CapturedFrame {
            rgba: vec![4, 5, 6],
            width: 1,
            height: 1,
        });
        let mut seq = 0;

        let frame = buffer
            .wait_next(&mut seq, Duration::from_millis(10))
            .unwrap();

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
