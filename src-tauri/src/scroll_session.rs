//! Tokio-driven capture loop for an active ScrollSession.

use crate::capture::capture_monitor_region;
use crate::scroll_stitch::{IngestResult, ScrollStitcher};
use crate::types::Rect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{interval, MissedTickBehavior};

const TICK_MS: u64 = 60;
const PROGRESS_THROTTLE_MS: u64 = 100;
const PREVIEW_TARGET_WIDTH: u32 = 640;
const PREVIEW_MAX_HEIGHT: u32 = 8192;

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    frames: u32,
    height: u32,
    preview_png_base64: String,
    last_score: f32,
}

pub(crate) fn emit_scroll_progress(
    app: &AppHandle,
    frames: u32,
    height: u32,
    preview_png: Vec<u8>,
    last_score: f32,
) {
    let _ = app.emit(
        "scroll:progress",
        ProgressPayload {
            frames,
            height,
            preview_png_base64: base64_encode(&preview_png),
            last_score,
        },
    );
}

pub(crate) fn emit_initial_progress(app: &AppHandle, stitcher: &ScrollStitcher) {
    emit_scroll_progress(
        app,
        0,
        stitcher.height(),
        stitcher.preview_stitched(PREVIEW_TARGET_WIDTH, PREVIEW_MAX_HEIGHT),
        1.0,
    );
}

pub fn spawn_loop(
    app: AppHandle,
    monitor_id: u32,
    rect: Rect,
    stitcher: Arc<AsyncMutex<ScrollStitcher>>,
    cancel: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_millis(TICK_MS));
        tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

        let mut frames_accepted: u32 = 0;
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut consecutive_failures: u32 = 0;

        loop {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            tick.tick().await;
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let frame = match capture_monitor_region(monitor_id, rect) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("scroll capture failed: {e}");
                    continue;
                }
            };
            if cancel.load(Ordering::SeqCst) {
                break;
            }

            let result = {
                let mut s = stitcher.lock().await;
                s.ingest(&frame)
            };

            match result {
                IngestResult::Appended {
                    new_height,
                    dy,
                    score,
                } => {
                    consecutive_failures = 0;
                    frames_accepted += 1;
                    tracing::info!(
                        target: "scroll",
                        "appended frame: dy={dy} score={score:.3} new_height={new_height} frames={frames_accepted}"
                    );
                    if last_emit.elapsed() >= Duration::from_millis(PROGRESS_THROTTLE_MS) {
                        last_emit = Instant::now();
                        let thumb = {
                            let s = stitcher.lock().await;
                            s.preview_stitched(PREVIEW_TARGET_WIDTH, PREVIEW_MAX_HEIGHT)
                        };
                        emit_scroll_progress(&app, frames_accepted, new_height, thumb, score);
                    }
                }
                IngestResult::NoChange => {
                    tracing::trace!(target: "scroll", "no change");
                }
                IngestResult::MatchFailed { score } => {
                    consecutive_failures += 1;
                    tracing::info!(
                        target: "scroll",
                        "match failed: score={score:.3} consecutive={consecutive_failures}"
                    );
                }
                IngestResult::MaxHeightReached => {
                    tracing::info!(target: "scroll", "max height reached frames={frames_accepted}");
                    cancel.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    });
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(ALPHA[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPHA[((n >> 12) & 0x3f) as usize] as char);
        match chunk.len() {
            3 => {
                out.push(ALPHA[((n >> 6) & 0x3f) as usize] as char);
                out.push(ALPHA[(n & 0x3f) as usize] as char);
            }
            2 => {
                out.push(ALPHA[((n >> 6) & 0x3f) as usize] as char);
                out.push('=');
            }
            _ => {
                out.push('=');
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn scroll_loop_does_not_emit_bottom_detection() {
        let source = include_str!("scroll_session.rs").replace("\r\n", "\n");
        let event_name = ["scroll", "end-detected"].join(":");
        let payload_name = ["End", "Detected", "Payload"].join("");

        assert!(
            !source.contains(&event_name) && !source.contains(&payload_name),
            "scroll capture should wait for the user to click Done instead of guessing the bottom",
        );
    }

    #[test]
    fn scroll_progress_uses_full_stitched_preview() {
        let source = include_str!("scroll_session.rs").replace("\r\n", "\n");

        assert!(
            source.contains("preview_stitched("),
            "scroll progress should send a full stitched preview, not a fixed-height bottom thumbnail",
        );
    }

    #[test]
    fn capture_loop_does_not_toggle_finish_window_visibility() {
        let source = include_str!("scroll_session.rs").replace("\r\n", "\n");
        let body_start = source.find("pub fn spawn_loop").unwrap();
        let body_end = source[body_start..]
            .find("fn base64_encode")
            .map(|idx| body_start + idx)
            .unwrap();
        let body = &source[body_start..body_end];

        assert!(
            !body.contains("set_scroll_finish_visible"),
            "scroll capture must not show/hide a finish window around each screen capture",
        );
    }
}
