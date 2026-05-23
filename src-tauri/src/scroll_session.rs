//! Tokio-driven capture loop for an active ScrollSession.

use crate::capture::capture_monitor_region;
use crate::scroll_stitch::{IngestResult, ScrollStitcher, StitchedImage};
use crate::types::Rect;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{interval, MissedTickBehavior};

const TICK_MS: u64 = 60;
const PROGRESS_THROTTLE_MS: u64 = 100;
const PREVIEW_TARGET_HEIGHT: u32 = 320;

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    frames: u32,
    height: u32,
    preview_png_base64: String,
    last_score: f32,
}

#[derive(serde::Serialize, Clone)]
struct EndDetectedPayload {
    reason: String,
}

#[derive(serde::Serialize, Clone)]
struct MatchFailedPayload {
    consecutive_failures: u32,
    score: f32,
}

pub fn spawn_loop(
    app: AppHandle,
    monitor_id: u32,
    rect: Rect,
    stitcher: Arc<AsyncMutex<ScrollStitcher>>,
    cancel: Arc<AtomicBool>,
    result_slot: Arc<std::sync::Mutex<Option<StitchedImage>>>,
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

            let frame = match capture_monitor_region(monitor_id, rect) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("scroll capture failed: {e}");
                    continue;
                }
            };

            let result = {
                let mut s = stitcher.lock().await;
                s.ingest(&frame)
            };

            match result {
                IngestResult::Appended {
                    new_height, dy, score,
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
                            s.preview_thumbnail(PREVIEW_TARGET_HEIGHT)
                        };
                        let _ = app.emit(
                            "scroll:progress",
                            ProgressPayload {
                                frames: frames_accepted,
                                height: new_height,
                                preview_png_base64: base64_encode(&thumb),
                                last_score: score,
                            },
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
                    let _ = app.emit(
                        "scroll:match-failed",
                        MatchFailedPayload {
                            consecutive_failures,
                            score,
                        },
                    );
                }
                IngestResult::EndOfScroll | IngestResult::MaxHeightReached => {
                    let is_max = matches!(result, IngestResult::MaxHeightReached);
                    let reason = if is_max { "max-height" } else { "bottom" };
                    tracing::info!(target: "scroll", "end detected: {reason} frames={frames_accepted}");
                    {
                        let s = stitcher.lock().await;
                        *result_slot.lock().unwrap() = Some(StitchedImage {
                            rgba: s.canvas_bytes_clone(),
                            width: s.width(),
                            height: s.height(),
                        });
                    }
                    let _ = app.emit(
                        "scroll:end-detected",
                        EndDetectedPayload {
                            reason: reason.to_string(),
                        },
                    );
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
