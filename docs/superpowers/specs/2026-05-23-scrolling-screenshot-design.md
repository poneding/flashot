# Scrolling Screenshot — Design Spec

- **Date**: 2026-05-23
- **Status**: Draft, awaiting review
- **Owner**: TBD
- **Target branch**: separate feature branch (TBD)

## 1. Goal

Add a scrolling-screenshot feature to Flashot so users can capture content that extends beyond the visible region (long web pages, chat scrollbacks, PDFs, code panels) and receive a single stitched image suitable for copy or save.

The feature must work on macOS, Windows, and Linux (X11) without per-platform input automation, must integrate cleanly with the existing capture/overlay/Toolbar architecture, and must not regress the current single-shot screenshot flow.

## 2. Non-goals

- No automated scrolling (no Accessibility / `SendMessage` / synthetic wheel events). The user scrolls; the tool stitches.
- No horizontal scrolling stitching in v1 — vertical only.
- No annotation pipeline on the stitched result. Output goes straight to clipboard or file.
- No multi-monitor scroll. Scroll capture is bounded to the monitor where the selection lives.
- No OCR, no PDF export, no shareable link — the result is a PNG.

## 3. User flow

1. User triggers capture (existing hotkey) and draws a selection — i.e. enters `committed` mode in `useOverlay`.
2. Existing vertical `Toolbar` now shows an additional **ScrollText** icon button next to Copy / Save / Pin / Close. Enabled only when the selection is at least 100 logical px tall and confined to a single monitor.
3. User clicks the scroll button:
   - The frozen-frame overlay is dismissed (the user must see live content to scroll).
   - The selection rect is locked in place; a translucent mask still outlines it; the rect's interior is mouse-transparent so wheel/touch events reach the underlying window.
   - A minimal status bar replaces the Toolbar: `Stitching · N frames · NNNNpx · ⌘/Ctrl+Enter to finish · Esc to cancel`. The status bar also exposes explicit `Done` and `Cancel` buttons.
   - A live preview strip appears to the right of the selection, showing a scaled-down view of the stitched canvas so far.
4. User scrolls. Backend captures ~16fps of the selection region only, feeds each frame through the stitcher, and emits progress events.
5. Stitching ends when **any** of the following happens:
   - 5 consecutive frames yield zero scroll delta (bottom detected).
   - Stitched height reaches 32768px (PNG safety cap).
   - User presses `⌘/Ctrl+Enter` or clicks the status bar `Done` button (manual finish).
   - User presses `Esc` or clicks the status bar `Cancel` button (cancel — discards the result, returns to `idle`).
6. On finish, the overlay transitions to `scrollFinalized`. The Toolbar reappears with Copy / Save buttons (Pin is hidden for v1). Clicking Copy puts the full stitched PNG on the clipboard; Save opens the existing save dialog. Either then ends the session.

## 4. Architecture overview

```
existing flow (unchanged):
   hotkey → freeze all monitors → spawn overlays → user selects → crop_and_copy/save

new flow (scrolling):
   committed mode → user clicks scroll button → start_scroll_session
                  → frozen overlay dismissed, mouse-transparent mask kept
                  → backend tokio loop captures selection at 60ms cadence
                  → ScrollStitcher.ingest() runs incremental NCC match + append
                  → scroll:progress event drives status bar + preview strip
                  → end detected / Enter / Esc → stop_scroll_session(commit)
                  → scroll_copy / scroll_save → SessionGuard drop cleans up
```

Two sessions are mutually exclusive: a scroll session can only be started from `committed` mode, and once active the single-shot frame buffers are dropped. There is no way to "go back" from `scrolling` to `committed` — only to `idle` (via cancel) or `scrollFinalized` (via finish).

## 5. Backend design

### 5.1 New module: `src-tauri/src/scroll_stitch.rs`

Pure-Rust stitching engine. No Tauri dependency, fully unit-testable.

```rust
pub struct ScrollStitcher {
    canvas: Vec<u8>,                    // accumulated RGBA
    width: u32,                         // physical width (fixed at start)
    height: u32,                        // current accumulated height
    last_frame: Option<Vec<u8>>,        // previous frame for matching
    static_drop_offset: u32,            // detected fixed-header height (v2; default 0)
    consecutive_no_change: u32,         // frames with dy == 0 in a row
    last_match_score: f32,              // for debugging / telemetry
    last_dy: u32,                       // last successful dy (fallback)
    config: StitchConfig,
}

pub struct StitchConfig {
    pub sample_columns: usize,          // default 9
    pub roi_rows: u32,                  // default 50
    pub min_match_score: f32,           // default 0.85
    pub max_height_px: u32,             // default 32_768
    pub end_of_scroll_frames: u32,      // default 5
}

pub enum IngestResult {
    Appended { new_height: u32, dy: u32, score: f32 },
    NoChange,                            // dy == 0
    EndOfScroll,                         // consecutive_no_change >= end_of_scroll_frames
    MatchFailed { score: f32 },          // below min_match_score; caller decides whether to retry
    MaxHeightReached,
}

impl ScrollStitcher {
    pub fn new(width: u32, initial_frame: Vec<u8>, config: StitchConfig) -> Self;
    pub fn ingest(&mut self, frame_rgba: &[u8]) -> IngestResult;
    pub fn finalize(self) -> StitchedImage;       // consume, return final RGBA + dims
    pub fn preview_thumbnail(&self, target_height_px: u32) -> Vec<u8>;  // for live preview
}
```

#### Matching algorithm (column-sampled NCC)

For each `ingest(new_frame)`:

1. Pick `sample_columns` x-coordinates evenly across width: `x_i = (i + 1) * width / (sample_columns + 1)`.
2. From `last_frame`, extract grayscale ROI: rows `[static_drop_offset .. static_drop_offset + roi_rows]`, only at the chosen columns. Store as a `sample_columns × roi_rows` matrix `T`.
3. For each candidate y in `[static_drop_offset .. height - roi_rows]` of `new_frame`, extract the same column samples as `S(y)`, compute normalized cross-correlation against `T`, average across columns.
4. Take `(best_y, best_score) = argmax`. If `best_score < min_match_score`, return `MatchFailed`.
5. `dy = best_y - static_drop_offset`. If `dy == 0`, increment `consecutive_no_change`; otherwise reset to 0.
6. If `consecutive_no_change >= end_of_scroll_frames`, return `EndOfScroll`.
7. Append `new_frame[dy * width * 4 ..]` to `canvas`. Update `height += new_frame.height - dy`. If new height > `max_height_px`, truncate and return `MaxHeightReached`. Otherwise return `Appended`.
8. Replace `last_frame` with `new_frame`.

Complexity per ingest: `O(sample_columns × H × roi_rows)` ≈ `9 × 1000 × 50 = 450k` ops on a 1000px-tall selection — well under 5ms target.

#### Algorithm dependencies

- `imageproc` crate for `match_template` primitives (we use it only for the NCC kernel; the column-sampling loop is hand-rolled to avoid full-image matching cost).
- `image` crate (already a transitive dependency) for RGBA buffer types.
- No `opencv` dependency — explicitly rejected for build/distribution reasons.

### 5.2 `WindowMgr` extension

```rust
pub struct ScrollSession {
    pub monitor_id: u32,
    pub rect: Rect,                          // physical pixels on the monitor
    pub stitcher: Arc<Mutex<ScrollStitcher>>,
    pub capture_handle: tokio::task::JoinHandle<()>,
    pub cancel_token: tokio_util::sync::CancellationToken,
    pub finalized: Arc<Mutex<Option<StitchedImage>>>,
}
```

- Added as `Option<ScrollSession>` on `WindowMgr`.
- `SessionGuard::drop` now also cancels the capture loop and joins the task synchronously (best-effort with timeout) before clearing the session field.
- `start_scroll_session` first calls the existing teardown for frozen frames (so the user sees live content), then constructs and stores the new `ScrollSession`.

### 5.3 Tokio capture loop

```rust
async fn run_scroll_capture_loop(
    monitor_id: u32,
    rect: Rect,
    stitcher: Arc<Mutex<ScrollStitcher>>,
    cancel: CancellationToken,
    app: AppHandle,
) {
    let mut interval = tokio::time::interval(Duration::from_millis(60));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {
                let frame = match capture_monitor_region(monitor_id, rect) {
                    Ok(f) => f,
                    Err(_) => continue,             // transient failure, try next tick
                };
                let result = {
                    let mut s = stitcher.lock().await;
                    s.ingest(&frame)
                };
                emit_progress(&app, &result, &stitcher).await;
                if matches!(result, IngestResult::EndOfScroll | IngestResult::MaxHeightReached) {
                    emit_end_detected(&app, &result);
                    break;
                }
            }
        }
    }
}
```

`capture_monitor_region` is a new helper that uses `xcap` to capture only the relevant monitor and crop in-place to the selection rect — never writes a PNG, never re-encodes.

### 5.4 New Tauri commands

| Command | Args | Returns | Behavior |
|---|---|---|---|
| `start_scroll_session` | `monitor_id, rect` | `()` | Dismiss frozen overlay, create `ScrollSession`, launch capture loop |
| `stop_scroll_session` | `commit: bool` | `Option<ScrollResult>` | Cancel loop; if `commit=true`, finalize stitcher and stash result in `WindowMgr`; if `commit=false`, drop result and end session |
| `scroll_copy` | — | `()` | Encode stashed result as RGBA → clipboard, then end session |
| `scroll_save` | — | `Option<String>` | Encode as PNG → save dialog (existing `saver` path), then end session |

`ScrollResult { width: u32, height: u32, frame_count: u32 }` is returned to the frontend so it knows how to size the preview / status bar at finalization.

### 5.5 Events

| Event | Payload | Cadence |
|---|---|---|
| `scroll:progress` | `{ frames: u32, height: u32, preview_png_base64: String, last_score: f32 }` | After every successful `Appended` ingest, throttled to ≤ 10 emits/sec |
| `scroll:end-detected` | `{ reason: "bottom" \| "max-height" }` | Once when loop terminates on its own |
| `scroll:match-failed` | `{ consecutive_failures: u32, score: f32 }` | When a `MatchFailed` ingest occurs; counter resets on next success |

Preview throttling: the loop runs at ~16 emits/sec worst case; we drop progress emits that arrive within 100ms of the previous one (keep the latest payload, debounce trailing edge). End-detected and match-failed are never throttled.

### 5.6 Overlay window changes

When entering scroll mode, the overlay window switches to **shape-based passthrough**: only the rectangular interior of the selection passes events through to the underlying window; the surrounding chrome (status bar, preview strip, selection outline) still receives mouse events normally.

- macOS: use a shaped event-passthrough region via `setMouseDownCanMoveWindow:NO` combined with `NSTrackingArea` exclusion on the selection interior, or fall back to setting `ignoresMouseEvents:YES` on the whole window and rendering the status bar as a separate undecorated child window. Final mechanism chosen during phase 2.
- Windows: full-window `WS_EX_LAYERED | WS_EX_TRANSPARENT` plus a separate `WS_EX_NOACTIVATE` child window for the status bar / preview strip (which must remain clickable).
- Linux (X11): use `XShapeCombineRectangles` to define the input region as everything *except* the selection interior. Wayland passthrough may not be feasible for v1 — see Open Questions.

**Keyboard handling**: because the overlay window may lose focus to the underlying app once the user starts scrolling, we cannot rely on the overlay's own keyboard event handlers. Instead, for the duration of the scroll session we register two global shortcuts via `tauri-plugin-global-shortcut`:

- `Esc` — cancel the scroll session (best-effort; collides with very few apps, and the collision window is short-lived)
- `CmdOrCtrl+Enter` — finish stitching (avoiding plain `Enter` which is too common; the binding is documented in the status bar hint)

Both shortcuts are registered on `start_scroll_session` and unregistered on session end (success, cancel, or drop). The status bar also provides explicit `Done` and `Cancel` buttons (clickable, since the status bar chrome is not passthrough) so users do not have to rely on shortcuts at all.

## 6. Frontend design

### 6.1 State machine extensions (`src/overlay/state.ts`)

`Mode` gains `"scrolling"` and `"scrollFinalized"`. New transitions:

- `committed → scrolling` via `startScroll()` action
- `scrolling → scrollFinalized` via `finalizeScroll(result)` action
- `scrolling → idle` via `cancelScroll()` action
- `scrollFinalized → idle` via `endScroll()` action (called after copy/save)

New state fields:

```ts
scrollProgress: { frames: number; height: number; previewDataUrl: string } | null;
scrollEndReason: "bottom" | "max-height" | "user" | null;
scrollResult: { width: number; height: number; frameCount: number } | null;
```

All scroll-related fields reset in `end()`.

### 6.2 New components

- `src/overlay/ScrollStatusBar.tsx`
  - Renders during `scrolling` mode in place of the Toolbar.
  - Shows: spinner, frame count, current height, hint text, plus `Done` and `Cancel` buttons (these are real interactive buttons since the status bar chrome is not in the passthrough region).
  - Anchored above or below the selection using the same positioning logic as the Toolbar.

- `src/overlay/ScrollPreview.tsx`
  - Renders a vertical strip to the right of the selection, max height = monitor height, fixed width 60px.
  - Displays the latest `previewDataUrl` from progress events, scaled to fit, scroll position pinned to the bottom (so the user sees the most recent capture).

- `src/lib/scroll-session.ts`
  - Subscribes to `scroll:progress`, `scroll:end-detected`, `scroll:match-failed`.
  - Dispatches state machine actions.
  - On `end-detected`, calls `stop_scroll_session(true)` and transitions to `scrollFinalized`.

### 6.3 Toolbar changes (`src/overlay/Toolbar.tsx`)

- Add `onScroll: ToolbarAction` prop.
- Add a `ScrollText` icon button between Pin and Close.
- Disable + tooltip "Selection too small" when `selection.height < 100`.
- In `scrollFinalized` mode, hide the Pin button (Pin not supported for stitched results in v1) and re-target Copy/Save to `scroll_copy` / `scroll_save`.

### 6.4 IPC wrappers (`src/lib/ipc.ts`)

Typed wrappers for the four new commands, matching the existing pattern (named exports, payload typing from `src/lib/types.ts`).

## 7. Error handling & edge cases

| Case | Handling |
|---|---|
| First-frame capture fails | Abort session, transition to `committed`, toast "Failed to start scroll capture" |
| 5 consecutive `MatchFailed` | Emit `scroll:match-failed` with counter; frontend shows non-fatal toast "Cannot detect scroll — try scrolling more slowly". Do not auto-terminate; user can keep trying or Esc. |
| Capture task panic | Wrap loop in `tokio::task::spawn` with `AssertUnwindSafe`; on panic, emit `scroll:match-failed` with synthetic payload and break the loop. SessionGuard drop still runs. |
| User Cmd-Tab or switches desktop | Capture continues (xcap is OS-level), but matching scores collapse → falls under match-failed path. |
| Selection rect crosses a monitor boundary | Disallowed at selection time (existing single-monitor invariant); no change needed. |
| Selection too small (`height < 100`) | Toolbar button disabled. |
| Stitched height ≥ 32768px | `MaxHeightReached` → end session automatically; user gets whatever was stitched. |
| Result encode fails on copy/save | Toast error, keep session alive so user can retry. |

## 8. Testing strategy

### 8.1 Rust unit tests (`src-tauri/src/scroll_stitch.rs`)

- Synthetic gradient frames offset by known dy → assert `Appended { dy }` equals the injected offset within ±1 px.
- Identical frames → assert `EndOfScroll` triggers after exactly `end_of_scroll_frames` iterations.
- Frames with garbage in top 30 rows (simulated fixed header) → assert correct dy when `static_drop_offset = 30`.
- Frames with random noise → assert `MatchFailed` triggers and score is logged.
- Total height exceeds `max_height_px` → assert `MaxHeightReached` and canvas length matches cap.
- Column-sampling result vs full-image NCC: random seeded inputs, dy disagreement ≤ 1 px in 95% of cases.

### 8.2 Rust benchmark (`src-tauri/benches/scroll_stitch_bench.rs`)

- 500×500 RGBA ingest: target < 5ms median.
- 1000×1000 RGBA ingest: target < 10ms median.
- Verified in CI (no display server needed, like `crop_bench`).

### 8.3 Frontend tests (`src/__tests__/`)

- State machine: `startScroll`, `finalizeScroll`, `cancelScroll`, `endScroll` transitions and field resets.
- `scroll-session.ts`: mocked Tauri event emitter drives state actions in the correct order.

### 8.4 Manual cross-platform acceptance

MVP ships only if all three platforms pass the same three targets:

1. Long web page in Chrome / Firefox (e.g. a docs page that scrolls 5×).
2. Long PDF page in the system PDF reader.
3. Chat scrollback (Slack / Discord / Telegram).

Each platform documents pass/fail in `docs/smoke-matrix.md`.

## 9. Implementation order

Phased so each phase is independently shippable behind an unfinished UI:

1. **Algorithm core** — `scroll_stitch.rs` + unit tests + bench. No Tauri integration.
2. **Backend session** — `WindowMgr::ScrollSession`, tokio loop, 4 new commands. Verify with a debug-only "manual ingest" command that takes pre-saved PNG sequences.
3. **Frontend base flow** — state machine extensions, Toolbar button, minimal status bar. End-to-end pass with no preview strip.
4. **Live preview** — `scroll:progress` payload includes preview PNG; `ScrollPreview` component renders it.
5. **Edge cases** — end-detection, match-failure toast, max-height cap, error toasts.
6. **Cross-platform validation** — fix per-platform issues found in manual acceptance.

Each phase ends with all tests green and is a candidate review checkpoint.

## 10. Open questions

- **Fixed-header auto-detection**: deferred to v2. v1 uses `static_drop_offset = 0`. If real-world testing shows persistent fixed-header confusion, prioritize auto-detection.
- **Preview throttling fidelity**: 10 emits/sec may feel laggy. If so, switch from RGBA→PNG re-encode to incremental delta blit (send only the new strip + its y-offset). Decide after first-pass perf measurement.
- **Linux passthrough mechanism**: validate during phase 2 — X11 has multiple options; Wayland may simply not work for v1 and we document that limitation.
- **Result reuse for Pin**: v1 disallows Pin on stitched results because the pin window has no scroll affordance. A future "scrollable pin" could lift this.

## 11. Out-of-scope (revisit later)

- Auto-scroll (any platform).
- Horizontal stitching.
- Annotation on stitched results.
- Multi-monitor stitched capture.
- OCR / text extraction.
- Cloud upload of long screenshots.
