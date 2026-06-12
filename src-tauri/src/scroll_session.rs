//! Tokio-driven capture loop for an active ScrollSession.

use crate::capture::capture_monitor_region;
use crate::scroll_stitch::{IngestResult, ScrollStitcher};
use crate::types::Rect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, EventTarget};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{interval, MissedTickBehavior};

const TICK_MS: u64 = 60;
const PROGRESS_THROTTLE_MS: u64 = 100;
/// Width of the encoded progress preview PNG in pixels.
pub(crate) const PREVIEW_TARGET_WIDTH: u32 = 640;
/// Floor for the per-session preview tail height (source rows at
/// `PREVIEW_TARGET_WIDTH`). The actual tail is derived from the chrome
/// viewport in `commands::tail_rows_for_chrome`; this floor keeps compact
/// panels comfortably covered.
pub(crate) const PREVIEW_TAIL_MIN_ROWS: u32 = 1024;
/// Cap for the per-session preview tail height; bounds the worst-case
/// per-emit encode cost for very tall chrome viewports.
pub(crate) const PREVIEW_TAIL_MAX_ROWS: u32 = 8192;

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    frames: u32,
    height: u32,
    preview_png_base64: String,
    last_score: f32,
}

/// Scroll events are targeted at the chrome webview window only (the caller
/// in `commands::start_scroll_session` builds `target` from the chrome
/// label) — progress payloads carry a base64 PNG and broadcasting them to
/// every webview is wasted serialization and delivery work.
pub(crate) fn emit_scroll_progress(
    app: &AppHandle,
    target: &EventTarget,
    frames: u32,
    height: u32,
    preview_png: Vec<u8>,
    last_score: f32,
) {
    let _ = app.emit_to(
        target.clone(),
        "scroll:progress",
        ProgressPayload {
            frames,
            height,
            preview_png_base64: base64_encode(&preview_png),
            last_score,
        },
    );
}

pub(crate) fn emit_initial_progress(
    app: &AppHandle,
    target: &EventTarget,
    preview_tail_rows: u32,
    stitcher: &ScrollStitcher,
) {
    emit_scroll_progress(
        app,
        target,
        0,
        stitcher.height(),
        stitcher.preview_tail(PREVIEW_TARGET_WIDTH, preview_tail_rows),
        1.0,
    );
}

pub fn spawn_loop(
    app: AppHandle,
    monitor_id: u32,
    rect: Rect,
    preview_tail_rows: u32,
    progress_target: EventTarget,
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
                        // Encoding the tail holds the stitcher mutex, but the
                        // cost is bounded by the tail window (a few ms), not
                        // by the canvas height.
                        let thumb = {
                            let s = stitcher.lock().await;
                            s.preview_tail(PREVIEW_TARGET_WIDTH, preview_tail_rows)
                        };
                        emit_scroll_progress(
                            &app,
                            &progress_target,
                            frames_accepted,
                            new_height,
                            thumb,
                            score,
                        );
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
                    // Tell the chrome window so it can finish through the
                    // same flow as the finish button (scroll_pin); session
                    // teardown stays in one place instead of being duplicated
                    // here.
                    let _ = app.emit_to(progress_target.clone(), "scroll:max-height", ());
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
    fn scroll_progress_sends_aspect_correct_tail_preview_to_chrome_window() {
        let source = include_str!("scroll_session.rs").replace("\r\n", "\n");
        let implementation = source
            .split("#[cfg(test)]")
            .next()
            .expect("implementation source");

        assert!(
            implementation.contains("preview_tail("),
            "progress should encode only the visible tail, not the full canvas",
        );
        assert!(
            !implementation.contains("preview_stitched("),
            "full-canvas preview encoding grows linearly with capture height",
        );
        assert!(
            implementation.contains("emit_to")
                || implementation.contains("EventTarget::webview_window"),
            "progress must target the chrome window, not broadcast to every webview",
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
