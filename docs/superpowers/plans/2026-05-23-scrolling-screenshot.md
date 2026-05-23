# Scrolling Screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual-scroll-driven scrolling screenshot feature to Flashot that captures content beyond the visible region, stitches frames via column-sampled normalized cross-correlation, and exports the result to clipboard or file.

**Architecture:** A new `ScrollSession` lives alongside the existing single-shot capture session in `WindowMgr`. When entered from a committed selection, the frozen overlay is dismissed, a tokio task captures the selection at 16 Hz, and an incremental stitcher (`scroll_stitch.rs`) appends new content into a growing canvas. The overlay becomes shape-passthrough so the user can scroll the underlying app while the chrome (status bar, preview strip) stays clickable. Finalization triggers either by 5-frames-of-no-change, max-height cap, or user input.

**Tech Stack:** Rust + Tauri 2 + `xcap` (capture) + `imageproc` (NCC kernel) + `image` (already present) + `tokio` (async loop) + React + Zustand + Vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-23-scrolling-screenshot-design.md`. Read it before starting.

---

## Phase 1 — Stitching algorithm (pure Rust, no Tauri)

### Task 1: Add `imageproc` dependency and bench harness

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `imageproc` to `[dependencies]` and register the new bench**

In `src-tauri/Cargo.toml`, under `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`, add after the `image` line:

```toml
imageproc = { version = "0.25", default-features = false }
```

Then at the bottom of the file, after the existing `[[bench]]` blocks, add:

```toml
[[bench]]
name = "scroll_stitch_bench"
harness = false
```

- [ ] **Step 2: Verify the workspace still builds**

Run: `cd src-tauri && cargo check`
Expected: clean compile, `imageproc` downloaded.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "chore: add imageproc dep and scroll_stitch_bench harness"
```

---

### Task 2: Create `scroll_stitch` module skeleton with public types

**Files:**
- Create: `src-tauri/src/scroll_stitch.rs`
- Modify: `src-tauri/src/lib.rs:1-13`

- [ ] **Step 1: Create the module with types only (no logic yet)**

Create `src-tauri/src/scroll_stitch.rs`:

```rust
//! Incremental stitcher for scrolling screenshots.
//!
//! Each `ingest()` call receives a fresh capture of the same on-screen rect
//! and decides how much of it is *new* (i.e. has scrolled into view since the
//! previous frame) by matching a column-sampled ROI from the previous frame
//! against the current frame. The new strip is appended to an accumulating
//! RGBA canvas which is consumed via `finalize()`.

#[derive(Clone, Copy, Debug)]
pub struct StitchConfig {
    pub sample_columns: usize,
    pub roi_rows: u32,
    pub min_match_score: f32,
    pub max_height_px: u32,
    pub end_of_scroll_frames: u32,
}

impl Default for StitchConfig {
    fn default() -> Self {
        Self {
            sample_columns: 9,
            roi_rows: 50,
            min_match_score: 0.85,
            max_height_px: 32_768,
            end_of_scroll_frames: 5,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum IngestResult {
    Appended { new_height: u32, dy: u32, score: f32 },
    NoChange,
    EndOfScroll,
    MatchFailed { score: f32 },
    MaxHeightReached,
}

pub struct StitchedImage {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub struct ScrollStitcher {
    canvas: Vec<u8>,
    width: u32,
    frame_height: u32,
    height: u32,
    last_frame: Vec<u8>,
    static_drop_offset: u32,
    consecutive_no_change: u32,
    config: StitchConfig,
}

impl ScrollStitcher {
    pub fn new(width: u32, frame_height: u32, initial_frame: Vec<u8>, config: StitchConfig) -> Self {
        assert_eq!(
            initial_frame.len(),
            (width * frame_height * 4) as usize,
            "initial frame size mismatch"
        );
        Self {
            canvas: initial_frame.clone(),
            width,
            frame_height,
            height: frame_height,
            last_frame: initial_frame,
            static_drop_offset: 0,
            consecutive_no_change: 0,
            config,
        }
    }

    pub fn width(&self) -> u32 { self.width }
    pub fn height(&self) -> u32 { self.height }
    pub fn consecutive_no_change(&self) -> u32 { self.consecutive_no_change }
}
```

- [ ] **Step 2: Register the module in lib.rs**

Edit `src-tauri/src/lib.rs` line 1-13. Insert `pub mod scroll_stitch;` alphabetically (between `pin_mgr` and `saver`):

```rust
pub mod capture;
pub mod clipboard;
pub mod commands;
pub mod hotkey;
pub mod overlay_window;
pub mod permission;
pub mod pin_mgr;
pub mod saver;
pub mod scroll_stitch;
pub mod settings_store;
pub mod tray;
pub mod types;
pub mod window_mgr;
pub mod window_probe;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs src-tauri/src/lib.rs
git commit -m "feat(scroll): add scroll_stitch module skeleton"
```

---

### Task 3: Implement column-sampled NCC matcher (TDD)

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write the failing test for the pure matcher**

Append to `src-tauri/src/scroll_stitch.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// 80×600 RGBA frame, vertical gradient (row y → luminance y).
    fn gradient_frame(width: u32, height: u32, offset: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let l = ((y as u32 + offset as u32) & 0xff) as u8;
            for _ in 0..width {
                v.extend_from_slice(&[l, l, l, 255]);
            }
        }
        v
    }

    #[test]
    fn column_match_recovers_known_offset() {
        let width = 80;
        let frame_height = 600;
        let prev = gradient_frame(width, frame_height, 0);
        // Frame B shifted up by 37 rows -> new content at the bottom 37 rows.
        let curr = gradient_frame(width, frame_height, 37);

        let (best_y, score) = column_match_ncc(
            &prev, &curr, width, frame_height,
            0, // static_drop_offset
            50, // roi_rows
            9, // sample_columns
        );

        assert!(
            (best_y as i32 - 37).abs() <= 1,
            "expected dy ≈ 37, got {best_y}"
        );
        assert!(score > 0.95, "score too low: {score}");
    }
}
```

- [ ] **Step 2: Run it to verify it fails (no `column_match_ncc` symbol)**

Run: `cd src-tauri && cargo test scroll_stitch::tests::column_match_recovers_known_offset`
Expected: compile error — `column_match_ncc` not found.

- [ ] **Step 3: Implement the matcher**

Insert this before `#[cfg(test)]` in `src-tauri/src/scroll_stitch.rs`:

```rust
/// Compute the best vertical shift (in rows) such that the top ROI of `prev`
/// matches a slice in `curr`. Returns `(best_y, score)` where `score` is the
/// average per-column normalized cross-correlation in [-1.0, 1.0].
///
/// `prev` and `curr` are both `width × height` RGBA buffers.
/// `static_drop_offset` skips the top N rows of `prev` when building the ROI
/// (used to ignore fixed headers). Set to 0 for v1.
pub fn column_match_ncc(
    prev: &[u8],
    curr: &[u8],
    width: u32,
    height: u32,
    static_drop_offset: u32,
    roi_rows: u32,
    sample_columns: usize,
) -> (u32, f32) {
    debug_assert_eq!(prev.len(), (width * height * 4) as usize);
    debug_assert_eq!(curr.len(), (width * height * 4) as usize);
    debug_assert!(static_drop_offset + roi_rows <= height);

    // Pick sample column x-indices evenly across the width.
    let cols: Vec<u32> = (1..=sample_columns)
        .map(|i| (i as u32 * width) / (sample_columns as u32 + 1))
        .collect();

    // Extract template: gray values from `prev` at (col, static_drop_offset..+roi_rows).
    let template = extract_column_strip(prev, width, &cols, static_drop_offset, roi_rows);
    let t_mean = template.iter().sum::<f32>() / template.len() as f32;
    let t_demean: Vec<f32> = template.iter().map(|v| v - t_mean).collect();
    let t_norm = t_demean.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-6);

    let max_y = height.saturating_sub(roi_rows);
    let mut best_y = 0u32;
    let mut best_score = f32::MIN;

    for y in static_drop_offset..=max_y {
        let candidate = extract_column_strip(curr, width, &cols, y, roi_rows);
        let c_mean = candidate.iter().sum::<f32>() / candidate.len() as f32;
        let mut dot = 0.0f32;
        let mut c_sq = 0.0f32;
        for (i, &c) in candidate.iter().enumerate() {
            let cd = c - c_mean;
            dot += t_demean[i] * cd;
            c_sq += cd * cd;
        }
        let c_norm = c_sq.sqrt().max(1e-6);
        let score = dot / (t_norm * c_norm);
        if score > best_score {
            best_score = score;
            best_y = y;
        }
    }

    (best_y - static_drop_offset, best_score)
}

/// Extract a flat vector of grayscale samples at the given (cols × rows) grid.
fn extract_column_strip(
    rgba: &[u8],
    width: u32,
    cols: &[u32],
    y_start: u32,
    rows: u32,
) -> Vec<f32> {
    let mut out = Vec::with_capacity(cols.len() * rows as usize);
    for row in 0..rows {
        let y = y_start + row;
        let row_start = (y * width) as usize * 4;
        for &x in cols {
            let p = row_start + x as usize * 4;
            // Rec. 601 luma; good enough for matching.
            let r = rgba[p] as f32;
            let g = rgba[p + 1] as f32;
            let b = rgba[p + 2] as f32;
            out.push(0.299 * r + 0.587 * g + 0.114 * b);
        }
    }
    out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test scroll_stitch::tests::column_match_recovers_known_offset`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "feat(scroll): implement column-sampled NCC matcher"
```

---

### Task 4: Implement `ingest()` append path (TDD)

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write the failing test**

Inside the existing `tests` module (above the closing `}`), add:

```rust
    #[test]
    fn ingest_appends_new_strip_for_known_scroll() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        let next = gradient_frame(width, frame_h, 37); // scrolled 37 rows
        let result = stitcher.ingest(&next);

        match result {
            IngestResult::Appended { new_height, dy, score } => {
                assert!((dy as i32 - 37).abs() <= 1, "dy={dy}");
                assert_eq!(new_height, frame_h + dy);
                assert_eq!(stitcher.height(), new_height);
                assert!(score > 0.95);
                assert_eq!(stitcher.canvas.len(), (width * new_height * 4) as usize);
            }
            other => panic!("expected Appended, got {other:?}"),
        }
    }
```

- [ ] **Step 2: Run it (will fail — `ingest` not defined)**

Run: `cd src-tauri && cargo test scroll_stitch::tests::ingest_appends_new_strip_for_known_scroll`
Expected: compile error — no method `ingest`.

- [ ] **Step 3: Implement `ingest()` (Appended branch only)**

Inside `impl ScrollStitcher`, add:

```rust
pub fn ingest(&mut self, frame_rgba: &[u8]) -> IngestResult {
    debug_assert_eq!(
        frame_rgba.len(),
        (self.width * self.frame_height * 4) as usize,
        "ingest frame size mismatch"
    );

    let (dy, score) = column_match_ncc(
        &self.last_frame,
        frame_rgba,
        self.width,
        self.frame_height,
        self.static_drop_offset,
        self.config.roi_rows,
        self.config.sample_columns,
    );

    if score < self.config.min_match_score {
        return IngestResult::MatchFailed { score };
    }

    if dy == 0 {
        self.consecutive_no_change += 1;
        if self.consecutive_no_change >= self.config.end_of_scroll_frames {
            return IngestResult::EndOfScroll;
        }
        // Don't replace last_frame on no-change; we want to keep the
        // canonical reference so a tiny redraw blip doesn't accumulate.
        return IngestResult::NoChange;
    }

    self.consecutive_no_change = 0;

    // Append rows [frame_height - dy .. frame_height] from the new frame.
    let strip_start = ((self.frame_height - dy) * self.width) as usize * 4;
    let strip_end = (self.frame_height * self.width) as usize * 4;
    let new_total_height = self.height + dy;

    if new_total_height > self.config.max_height_px {
        // Append whatever fits, mark done.
        let allowed_dy = self.config.max_height_px - self.height;
        let truncated_start =
            ((self.frame_height - allowed_dy) * self.width) as usize * 4;
        self.canvas
            .extend_from_slice(&frame_rgba[truncated_start..strip_end]);
        self.height = self.config.max_height_px;
        self.last_frame.copy_from_slice(frame_rgba);
        return IngestResult::MaxHeightReached;
    }

    self.canvas
        .extend_from_slice(&frame_rgba[strip_start..strip_end]);
    self.height = new_total_height;
    self.last_frame.copy_from_slice(frame_rgba);

    IngestResult::Appended {
        new_height: self.height,
        dy,
        score,
    }
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test scroll_stitch::tests::ingest_appends`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "feat(scroll): ingest appends new strip with score gating"
```

---

### Task 5: TDD the `NoChange` → `EndOfScroll` transition

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write the test**

Inside `tests` mod, add:

```rust
    #[test]
    fn repeated_identical_frames_trigger_end_of_scroll() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial.clone(), StitchConfig::default());

        // 4 identical follow-ups should all be NoChange.
        for i in 0..4 {
            let r = stitcher.ingest(&initial);
            assert_eq!(r, IngestResult::NoChange, "iteration {i}");
        }
        // 5th identical follow-up trips EndOfScroll (default end_of_scroll_frames=5).
        assert_eq!(stitcher.ingest(&initial), IngestResult::EndOfScroll);
    }
```

- [ ] **Step 2: Run it — should already pass (logic exists)**

Run: `cd src-tauri && cargo test scroll_stitch::tests::repeated_identical_frames_trigger_end_of_scroll`
Expected: 1 passed.

If it fails, debug `consecutive_no_change` accounting in `ingest()`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "test(scroll): verify EndOfScroll triggers after N no-change frames"
```

---

### Task 6: TDD `MatchFailed` branch

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write the test**

Inside `tests`:

```rust
    #[test]
    fn random_noise_frame_triggers_match_failed() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        // Pseudo-random noise frame uncorrelated with the gradient.
        let mut noise = Vec::with_capacity((width * frame_h * 4) as usize);
        let mut seed: u32 = 0x9E3779B9;
        for _ in 0..(width * frame_h) {
            seed = seed.wrapping_mul(2654435761).wrapping_add(1);
            let b = (seed >> 24) as u8;
            noise.extend_from_slice(&[b, b.wrapping_add(73), b.wrapping_add(151), 255]);
        }

        match stitcher.ingest(&noise) {
            IngestResult::MatchFailed { score } => {
                assert!(score < 0.85, "score should be below threshold: {score}");
            }
            other => panic!("expected MatchFailed, got {other:?}"),
        }
        // Canvas must not grow on match failure.
        assert_eq!(stitcher.height(), frame_h);
    }
```

- [ ] **Step 2: Run it**

Run: `cd src-tauri && cargo test scroll_stitch::tests::random_noise_frame_triggers_match_failed`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "test(scroll): verify MatchFailed on uncorrelated frames"
```

---

### Task 7: TDD `MaxHeightReached` cap

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write the test**

Inside `tests`:

```rust
    #[test]
    fn max_height_caps_canvas_growth() {
        let width = 80;
        let frame_h = 100;
        let initial = gradient_frame(width, frame_h, 0);
        // Tight cap so we hit it quickly.
        let config = StitchConfig { max_height_px: 150, ..StitchConfig::default() };
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, config);

        // Frame scrolled 60 rows -> would push height to 160 (> cap 150).
        let next = gradient_frame(width, frame_h, 60);
        let r = stitcher.ingest(&next);
        assert_eq!(r, IngestResult::MaxHeightReached);
        assert_eq!(stitcher.height(), 150);
        assert_eq!(stitcher.canvas.len(), (width * 150 * 4) as usize);
    }
```

- [ ] **Step 2: Run it**

Run: `cd src-tauri && cargo test scroll_stitch::tests::max_height_caps_canvas_growth`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "test(scroll): verify MaxHeightReached cap"
```

---

### Task 8: Implement `finalize()` and `preview_thumbnail()`

**Files:**
- Modify: `src-tauri/src/scroll_stitch.rs`

- [ ] **Step 1: Write tests**

Inside `tests`:

```rust
    #[test]
    fn finalize_returns_canvas_dims() {
        let width = 80;
        let frame_h = 100;
        let stitcher = ScrollStitcher::new(
            width, frame_h, gradient_frame(width, frame_h, 0), StitchConfig::default(),
        );
        let img = stitcher.finalize();
        assert_eq!(img.width, width);
        assert_eq!(img.height, frame_h);
        assert_eq!(img.rgba.len(), (width * frame_h * 4) as usize);
    }

    #[test]
    fn preview_thumbnail_downscales_to_target_height() {
        let width = 80;
        let frame_h = 800;
        let stitcher = ScrollStitcher::new(
            width, frame_h, gradient_frame(width, frame_h, 0), StitchConfig::default(),
        );
        let thumb = stitcher.preview_thumbnail(200);
        // Header (8 bytes) + IHDR exists in PNG; we just assert valid PNG length.
        assert!(thumb.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&thumb).unwrap().to_rgba8();
        assert!(decoded.height() <= 200);
        assert!(decoded.height() > 0);
    }
```

- [ ] **Step 2: Run — should fail (missing methods)**

Run: `cd src-tauri && cargo test scroll_stitch::tests::finalize`
Expected: compile error.

- [ ] **Step 3: Implement**

Inside `impl ScrollStitcher`, add:

```rust
pub fn finalize(self) -> StitchedImage {
    StitchedImage { rgba: self.canvas, width: self.width, height: self.height }
}

pub fn preview_thumbnail(&self, target_height_px: u32) -> Vec<u8> {
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder, ImageBuffer, RgbaImage, imageops::FilterType};

    let src: RgbaImage = ImageBuffer::from_raw(self.width, self.height, self.canvas.clone())
        .expect("canvas dims match buffer");
    let scale = (target_height_px as f32 / self.height as f32).min(1.0);
    let target_w = ((self.width as f32) * scale).max(1.0) as u32;
    let target_h = ((self.height as f32) * scale).max(1.0) as u32;
    let scaled = image::imageops::resize(&src, target_w, target_h, FilterType::Triangle);

    let mut buf = Vec::new();
    PngEncoder::new(&mut buf)
        .write_image(scaled.as_raw(), target_w, target_h, ExtendedColorType::Rgba8)
        .expect("PNG encode");
    buf
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test scroll_stitch::`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scroll_stitch.rs
git commit -m "feat(scroll): finalize and preview_thumbnail"
```

---

### Task 9: Add criterion benchmark

**Files:**
- Create: `src-tauri/benches/scroll_stitch_bench.rs`

- [ ] **Step 1: Write the bench file**

```rust
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use flashot_lib::scroll_stitch::{ScrollStitcher, StitchConfig};

fn gradient(width: u32, height: u32, offset: u32) -> Vec<u8> {
    let mut v = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let l = ((y + offset) & 0xff) as u8;
        for _ in 0..width {
            v.extend_from_slice(&[l, l, l, 255]);
        }
    }
    v
}

fn bench(c: &mut Criterion) {
    let width = 500u32;
    let height = 500u32;
    c.bench_function("ingest_500x500", |b| {
        let initial = gradient(width, height, 0);
        let next = gradient(width, height, 30);
        b.iter_batched(
            || ScrollStitcher::new(width, height, initial.clone(), StitchConfig::default()),
            |mut s| { let _ = s.ingest(black_box(&next)); },
            criterion::BatchSize::SmallInput,
        )
    });

    let w2 = 1000u32;
    let h2 = 1000u32;
    c.bench_function("ingest_1000x1000", |b| {
        let initial = gradient(w2, h2, 0);
        let next = gradient(w2, h2, 30);
        b.iter_batched(
            || ScrollStitcher::new(w2, h2, initial.clone(), StitchConfig::default()),
            |mut s| { let _ = s.ingest(black_box(&next)); },
            criterion::BatchSize::SmallInput,
        )
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
```

- [ ] **Step 2: Run the bench (sanity, not perf gate)**

Run: `cd src-tauri && cargo bench --bench scroll_stitch_bench -- --warm-up-time 1 --measurement-time 2`
Expected: completes, both benches reported. Median for 500×500 should be < 5ms; 1000×1000 < 15ms. If higher, profile before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/benches/scroll_stitch_bench.rs
git commit -m "bench(scroll): add ingest microbenchmarks"
```

---

## Phase 2 — Backend session (Tauri integration)

### Task 10: Add `ScrollSession` to `WindowMgr`

**Files:**
- Modify: `src-tauri/src/window_mgr.rs`

- [ ] **Step 1: Extend `Inner` and add accessors**

Edit `window_mgr.rs`. At the top, add `use crate::scroll_stitch::{ScrollStitcher, StitchedImage};` after the existing `use crate::types::FrozenFrame;` line.

Replace the `Inner` struct:

```rust
#[derive(Default)]
struct Inner {
    frames: HashMap<u32, FrozenFrame>,
    in_session: bool,
    scroll: Option<ScrollState>,
}

pub(crate) struct ScrollState {
    pub monitor_id: u32,
    pub rect: crate::types::Rect,           // physical px
    pub stitcher: Arc<tokio::sync::Mutex<ScrollStitcher>>,
    pub cancel: Arc<std::sync::atomic::AtomicBool>,
    pub result: Arc<std::sync::Mutex<Option<StitchedImage>>>,
}
```

Then on `WindowMgr`, add:

```rust
pub(crate) fn take_scroll(&self) -> Option<ScrollState> {
    self.inner.lock().scroll.take()
}
pub(crate) fn set_scroll(&self, s: ScrollState) {
    self.inner.lock().scroll = Some(s);
}
pub(crate) fn scroll_ref<R>(&self, f: impl FnOnce(&ScrollState) -> R) -> Option<R> {
    self.inner.lock().scroll.as_ref().map(f)
}
```

In `clear_session_state`, after `inner.frames.clear()` add:

```rust
if let Some(s) = inner.scroll.take() {
    s.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
}
```

- [ ] **Step 2: Add `take_scroll_result` and `finalize_scroll_to_result` accessors on `WindowMgr`**

Append to `impl WindowMgr`:

```rust
pub(crate) fn take_scroll_result(&self) -> Option<crate::scroll_stitch::StitchedImage> {
    self.inner.lock().scroll.as_ref().and_then(|s| s.result.lock().unwrap().take())
}
```

This avoids the awkward take-then-reinsert pattern; the result is consumed in place.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/window_mgr.rs
git commit -m "feat(scroll): add ScrollState slot to WindowMgr"
```

---

### Task 11: Add `capture_monitor_region` helper

**Files:**
- Modify: `src-tauri/src/capture/mod.rs` (or wherever `enumerate_monitors` lives; locate first)

- [ ] **Step 1: Find the capture module entry point**

Run: `grep -rn "pub fn enumerate_monitors\|fn capture_monitor" src-tauri/src/capture/`
Note the file. The new helper goes alongside the existing per-monitor capture.

- [ ] **Step 2: Add the helper**

In the same file (likely `src-tauri/src/capture/mod.rs`), add a new public function:

```rust
/// Capture a single monitor and crop to the given physical-pixel rect.
/// Used by scroll capture loop — returns just the selection bytes, no disk I/O.
pub fn capture_monitor_region(monitor_id: u32, rect_physical: crate::types::Rect) -> anyhow::Result<Vec<u8>> {
    use xcap::Monitor;
    let monitors = Monitor::all()?;
    let mon = monitors
        .into_iter()
        .find(|m| m.id().unwrap_or(0) == monitor_id)
        .ok_or_else(|| anyhow::anyhow!("monitor {monitor_id} not found"))?;
    let img = mon.capture_image()?;
    let (w, _h) = (img.width(), img.height());
    let rgba = img.into_raw();

    let mut out = Vec::with_capacity((rect_physical.width * rect_physical.height * 4) as usize);
    for row in 0..rect_physical.height {
        let y = rect_physical.y + row;
        let start = (y as u32 * w + rect_physical.x as u32) as usize * 4;
        let end = start + (rect_physical.width as usize) * 4;
        out.extend_from_slice(&rgba[start..end]);
    }
    Ok(out)
}
```

If the existing capture file uses a different `Rect` field naming or pre-resolves the `Monitor`, mirror that pattern instead.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/capture/
git commit -m "feat(scroll): add capture_monitor_region helper"
```

---

### Task 12: Implement the tokio capture loop

**Files:**
- Create: `src-tauri/src/scroll_session.rs`
- Modify: `src-tauri/src/lib.rs:1-13`

- [ ] **Step 1: Create the new module**

Create `src-tauri/src/scroll_session.rs`:

```rust
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

            let result = { let mut s = stitcher.lock().await; s.ingest(&frame) };

            match result {
                IngestResult::Appended { new_height, score, .. } => {
                    consecutive_failures = 0;
                    frames_accepted += 1;
                    if last_emit.elapsed() >= Duration::from_millis(PROGRESS_THROTTLE_MS) {
                        last_emit = Instant::now();
                        let thumb = {
                            let s = stitcher.lock().await;
                            s.preview_thumbnail(PREVIEW_TARGET_HEIGHT)
                        };
                        let _ = app.emit("scroll:progress", ProgressPayload {
                            frames: frames_accepted,
                            height: new_height,
                            preview_png_base64: base64_encode(&thumb),
                            last_score: score,
                        });
                    }
                }
                IngestResult::NoChange => {}
                IngestResult::MatchFailed { score } => {
                    consecutive_failures += 1;
                    let _ = app.emit("scroll:match-failed", MatchFailedPayload {
                        consecutive_failures,
                        score,
                    });
                }
                IngestResult::EndOfScroll | IngestResult::MaxHeightReached => {
                    let reason = if matches!(result, IngestResult::MaxHeightReached) {
                        "max-height"
                    } else {
                        "bottom"
                    };
                    // Stash the finalized image so scroll_copy / scroll_save can pick it up.
                    {
                        let s = stitcher.lock().await;
                        *result_slot.lock().unwrap() = Some(StitchedImage {
                            rgba: s.canvas_bytes_clone(),
                            width: s.width(),
                            height: s.height(),
                        });
                    }
                    let _ = app.emit("scroll:end-detected", EndDetectedPayload {
                        reason: reason.to_string(),
                    });
                    cancel.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    });
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
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
            _ => { out.push('='); out.push('='); }
        }
    }
    out
}
```

- [ ] **Step 2: Expose `canvas_bytes_clone()` on the stitcher**

Edit `src-tauri/src/scroll_stitch.rs`, add to `impl ScrollStitcher`:

```rust
pub fn canvas_bytes_clone(&self) -> Vec<u8> {
    self.canvas.clone()
}
```

- [ ] **Step 3: Register the new module in lib.rs**

Edit `src-tauri/src/lib.rs:1-13`. Insert `pub mod scroll_session;` after `pub mod scroll_stitch;`.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean. Fix any missed imports.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scroll_session.rs src-tauri/src/scroll_stitch.rs src-tauri/src/lib.rs
git commit -m "feat(scroll): tokio capture loop emitting progress events"
```

---

### Task 13: Implement the four Tauri commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (handler registration)

- [ ] **Step 1: Add ScrollResult type at top of commands.rs**

Insert near other type imports in `src-tauri/src/commands.rs`:

```rust
#[derive(serde::Serialize, Clone)]
pub struct ScrollResult {
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
}
```

- [ ] **Step 2: Append the four new commands at the bottom of commands.rs (above `#[cfg(test)]`)**

```rust
#[tauri::command]
pub async fn start_scroll_session(
    monitor_id: u32,
    rect: Rect,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    use crate::scroll_stitch::{ScrollStitcher, StitchConfig};
    use crate::window_mgr::ScrollState;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::Mutex as AsyncMutex;

    // 1. Dismiss the frozen overlay so the user can see live content.
    //    But keep the in_session flag — we still own the overlay window labels.
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let scale = frame.scale_factor.max(1.0);
    let phys_rect = Rect {
        x: (rect.x as f32 * scale).round() as i32,
        y: (rect.y as f32 * scale).round() as i32,
        width: (rect.width as f32 * scale).round() as u32,
        height: (rect.height as f32 * scale).round() as u32,
    };

    // 2. Capture the initial frame from the live screen (not the frozen one).
    let initial = crate::capture::capture_monitor_region(monitor_id, phys_rect)
        .map_err(|e| format!("initial capture failed: {e}"))?;

    // 3. Hide frozen overlays' selection rect (interior shape-passthrough).
    let _ = app.emit("scroll:overlay-passthrough", phys_rect);

    let stitcher = Arc::new(AsyncMutex::new(ScrollStitcher::new(
        phys_rect.width,
        phys_rect.height,
        initial,
        StitchConfig::default(),
    )));
    let cancel = Arc::new(AtomicBool::new(false));
    let result_slot = Arc::new(std::sync::Mutex::new(None));

    crate::scroll_session::spawn_loop(
        app.clone(),
        monitor_id,
        phys_rect,
        stitcher.clone(),
        cancel.clone(),
        result_slot.clone(),
    );

    mgr.set_scroll(ScrollState {
        monitor_id,
        rect: phys_rect,
        stitcher,
        cancel,
        result: result_slot,
    });
    Ok(())
}

#[tauri::command]
pub async fn stop_scroll_session(
    commit: bool,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<ScrollResult>, String> {
    // Grab the cancel handle + stitcher Arc clones without taking the state out.
    let (cancel, stitcher_arc, result_arc) = mgr
        .scroll_ref(|s| (s.cancel.clone(), s.stitcher.clone(), s.result.clone()))
        .ok_or("no active scroll session")?;
    cancel.store(true, std::sync::atomic::Ordering::SeqCst);

    if !commit {
        // Cancelled: clear state and tear down the outer overlay.
        let _ = mgr.take_scroll();
        mgr.end_session(&app);
        return Ok(None);
    }

    // Finalize in place: if the loop already stashed a result (auto end-of-scroll),
    // reuse it; otherwise clone the current canvas into the slot.
    let summary = {
        let mut slot = result_arc.lock().unwrap();
        if slot.is_none() {
            let s = stitcher_arc.lock().await;
            *slot = Some(crate::scroll_stitch::StitchedImage {
                rgba: s.canvas_bytes_clone(),
                width: s.width(),
                height: s.height(),
            });
        }
        let img = slot.as_ref().unwrap();
        ScrollResult { width: img.width, height: img.height, frame_count: 0 }
    };

    Ok(Some(summary))
}

#[tauri::command]
pub async fn scroll_copy(
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let img = mgr.take_scroll_result().ok_or("no scroll result available")?;
    let _ = mgr.take_scroll();
    clipboard::copy_image(img.rgba, img.width, img.height).map_err(|e| e.to_string())?;
    mgr.end_session(&app);
    Ok(())
}

#[tauri::command]
pub async fn scroll_save(
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let img = mgr.take_scroll_result().ok_or("no scroll result available")?;
    let _ = mgr.take_scroll();
    let mut settings = settings_store::load().unwrap_or_default();
    mgr.end_session(&app);
    let path = saver::save_image_dialog(img.rgba, img.width, img.height, &settings)
        .map_err(|e| e.to_string())?;
    if let Some(saved_path) = path.as_deref() {
        saver::remember_last_save_dir(&mut settings, saved_path);
        settings_store::save(&settings).map_err(|e| e.to_string())?;
        let _ = app.emit("settings:changed", ());
    }
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}
```

- [ ] **Step 3: Register all four in `lib.rs`**

Edit `src-tauri/src/lib.rs:231-247`. Add four more lines inside `generate_handler!` after `commands::set_pin_scale,`:

```rust
            commands::start_scroll_session,
            commands::stop_scroll_session,
            commands::scroll_copy,
            commands::scroll_save,
```

- [ ] **Step 4: Build the whole crate**

Run: `cd src-tauri && cargo check && cargo clippy -- -D warnings`
Expected: clean. Fix compile / clippy errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(scroll): add start/stop/copy/save tauri commands"
```

---

### Task 14: Verify `SessionGuard` drop cancels scroll loop

**Files:**
- Modify: `src-tauri/src/window_mgr.rs` (tests)

- [ ] **Step 1: Write a test that verifies the cancel flag flips**

Append to the `tests` mod in `window_mgr.rs`:

```rust
    #[test]
    fn clear_session_state_cancels_active_scroll() {
        use crate::scroll_stitch::{ScrollStitcher, StitchConfig};
        use std::sync::atomic::{AtomicBool, Ordering};

        let mgr = WindowMgr::new();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let stitcher = std::sync::Arc::new(tokio::sync::Mutex::new(
            ScrollStitcher::new(2, 2, vec![0; 16], StitchConfig::default()),
        ));
        let result = std::sync::Arc::new(std::sync::Mutex::new(None));
        mgr.set_scroll(super::ScrollState {
            monitor_id: 1,
            rect: crate::types::Rect { x: 0, y: 0, width: 2, height: 2 },
            stitcher,
            cancel: cancel.clone(),
            result,
        });

        mgr.clear_session_state();
        assert!(cancel.load(Ordering::SeqCst), "scroll cancel must be set");
        assert!(mgr.scroll_ref(|_| ()).is_none());
    }
```

If `clear_session_state` is private, mark it `pub(crate)` for tests (it already is — verify).

- [ ] **Step 2: Run the test**

Run: `cd src-tauri && cargo test window_mgr::tests::clear_session_state_cancels_active_scroll`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window_mgr.rs
git commit -m "test(scroll): clear_session_state cancels active scroll loop"
```

---

## Phase 3 — Frontend base flow

### Task 15: Extend `types.ts` with the new mode and payloads

**Architecture note for Phase 3:** the status bar, preview strip, copy/save UI all live in a **separate chrome webview window** (built in Phase 4 Task 24). The main overlay window only needs to (a) know it is in `scrolling` mode so it hides its Toolbar and (b) trigger backend commands. All progress/finalization UI is owned by the chrome window's own state. This keeps cross-window coupling minimal.

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Update `Mode` union and add shared types**

Replace the `Mode` line and append the shared types at the bottom of `src/lib/types.ts`:

```ts
export type Mode = "idle" | "hover" | "dragging" | "committed" | "locked" | "scrolling";

export type ScrollProgress = {
  frames: number;
  height: number;
  previewDataUrl: string;
  lastScore: number;
};

export type ScrollEndReason = "bottom" | "max-height" | "user";

export type ScrollResult = {
  width: number;
  height: number;
  frameCount: number;
};
```

- [ ] **Step 2: TypeScript check**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(scroll): add scrolling mode and shared scroll types"
```

---

### Task 16: Add IPC wrappers and event subscribers

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Append the new wrappers**

At the bottom of `src/lib/ipc.ts`:

```ts
import type { ScrollProgress, ScrollResult, ScrollEndReason, Rect as _RectAgain } from "@/lib/types";
// (the existing top-of-file Rect import suffices; this comment exists only as a placeholder if you must re-import)

export async function startScrollSession(monitorId: number, rect: Rect): Promise<void> {
  await invoke("start_scroll_session", { monitorId, rect });
}

export async function stopScrollSession(commit: boolean): Promise<ScrollResult | null> {
  return await invoke<ScrollResult | null>("stop_scroll_session", { commit });
}

export async function scrollCopy(): Promise<void> {
  await invoke("scroll_copy");
}

export async function scrollSave(): Promise<string | null> {
  return await invoke<string | null>("scroll_save");
}

// Note: scroll_copy / scroll_save / stop_scroll_session do NOT take a monitorId
// argument. The backend reads it from the active ScrollState and uses it to
// tear down the chrome window. This keeps the TS surface minimal.

type ScrollProgressEvent = {
  frames: number;
  height: number;
  preview_png_base64: string;
  last_score: number;
};

export function onScrollProgress(cb: (p: ScrollProgress) => void): Promise<UnlistenFn> {
  return listen<ScrollProgressEvent>("scroll:progress", (e) => {
    cb({
      frames: e.payload.frames,
      height: e.payload.height,
      previewDataUrl: `data:image/png;base64,${e.payload.preview_png_base64}`,
      lastScore: e.payload.last_score,
    });
  });
}

export function onScrollEndDetected(cb: (reason: ScrollEndReason) => void): Promise<UnlistenFn> {
  return listen<{ reason: ScrollEndReason }>("scroll:end-detected", (e) => cb(e.payload.reason));
}

export function onScrollMatchFailed(cb: (info: { consecutiveFailures: number; score: number }) => void): Promise<UnlistenFn> {
  return listen<{ consecutive_failures: number; score: number }>("scroll:match-failed", (e) =>
    cb({ consecutiveFailures: e.payload.consecutive_failures, score: e.payload.score }),
  );
}
```

Remove the placeholder `_RectAgain` import comment if `Rect` is already imported above.

- [ ] **Step 2: Type check**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(scroll): typed IPC wrappers and event subscribers"
```

---

### Task 17: Extend `state.ts` with the `scrolling` mode (TDD)

**Files:**
- Create: `src/__tests__/scroll-state.test.ts`
- Modify: `src/overlay/state.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/scroll-state.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useOverlay } from "@/overlay/state";

function reset() {
  useOverlay.getState().end();
}

describe("scroll state transitions", () => {
  beforeEach(() => reset());

  it("startScroll moves committed → scrolling", () => {
    const s = useOverlay.getState();
    s.commit({ x: 0, y: 0, width: 200, height: 200 });
    expect(useOverlay.getState().mode).toBe("committed");
    s.startScroll();
    expect(useOverlay.getState().mode).toBe("scrolling");
  });

  it("startScroll is a no-op from non-committed modes", () => {
    useOverlay.getState().startScroll();
    expect(useOverlay.getState().mode).toBe("idle");
  });

  it("end() from scrolling returns to idle", () => {
    const s = useOverlay.getState();
    s.commit({ x: 0, y: 0, width: 200, height: 200 });
    s.startScroll();
    s.end();
    expect(useOverlay.getState().mode).toBe("idle");
  });
});
```

- [ ] **Step 2: Run — should fail (action doesn't exist)**

Run: `pnpm test scroll-state`
Expected: failures.

- [ ] **Step 3: Implement the state extension**

Edit `src/overlay/state.ts`:

1. Add `startScroll: () => void;` to the `Actions` type.
2. Add the implementation alongside other actions:

   ```ts
   startScroll: () => {
     if (get().mode !== "committed") return;
     set({
       mode: "scrolling",
       colorPickerVisible: false,
       selectionInteraction: null,
     });
   },
   ```

3. The existing `end()` already resets mode to `idle`, so the third test passes without further changes.

- [ ] **Step 4: Run tests**

Run: `pnpm test scroll-state`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/scroll-state.test.ts src/overlay/state.ts
git commit -m "feat(scroll): state machine scrolling mode"
```

---

### Task 18: Add Scroll button to Toolbar

**Files:**
- Modify: `src/overlay/Toolbar.tsx`

- [ ] **Step 1: Add the new prop and button**

Edit `src/overlay/Toolbar.tsx`:

1. Add `ScrollText` to the lucide-react import:
   ```ts
   import { CopyIcon, GripHorizontal, PinIcon, SaveIcon, ScrollText, XIcon, type LucideIcon } from "lucide-react";
   ```
2. Add to `Props`:
   ```ts
   onScroll: ToolbarAction;
   selectionTooSmall?: boolean;
   ```
3. Destructure `onScroll, selectionTooSmall` in the function signature.
4. In the button list (between Pin and Close), insert:
   ```tsx
   <ToolbarButton
     label={selectionTooSmall ? "Selection too small" : "Scrolling screenshot"}
     icon={ScrollText}
     onClick={() => runAction(onScroll)}
     disabled={selectionTooSmall}
   />
   ```
5. If `ToolbarButton` does not already accept `disabled`, add it to its props and apply via `aria-disabled` + `pointer-events: none` in the existing style block.

- [ ] **Step 2: TypeScript check**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/overlay/Toolbar.tsx
git commit -m "feat(scroll): scrolling screenshot button in Toolbar"
```

---

### Task 19: Wire `scrolling` mode into `Overlay.tsx`

**Files:**
- Modify: `src/routes/Overlay.tsx`
- Modify: `src/overlay/Toolbar.tsx`

In `scrolling` mode, the main overlay window only needs to (a) hide its Toolbar, (b) keep the selection outline visible for context, and (c) trigger backend commands. All status/preview/finalize UI is owned by the chrome window (Phase 4 Task 24).

- [ ] **Step 1: Read the current Overlay route**

Run: `wc -l src/routes/Overlay.tsx && grep -n "Toolbar\|useOverlay\|cropAndCopy\|cropAndSave" src/routes/Overlay.tsx`
Note the lines where Toolbar is mounted and where mode-conditional rendering exists.

- [ ] **Step 2: Wire the Scroll button's onClick**

Edit the Toolbar mount site in `src/routes/Overlay.tsx`. Use the existing `useOverlay` selector pattern:

```tsx
const selection = useOverlay((s) => s.selection);
const monitorId = useOverlay((s) => s.monitorId);
const startScroll = useOverlay((s) => s.startScroll);

// ... inside the Toolbar:
<Toolbar
  // ... existing props
  onScroll={async () => {
    if (monitorId == null || !selection) return;
    await startScrollSession(monitorId, selection);
    startScroll();
  }}
  selectionTooSmall={(selection?.height ?? 0) < 100}
/>
```

Add the import at the top:

```tsx
import { startScrollSession } from "@/lib/ipc";
```

- [ ] **Step 3: Hide the Toolbar during scrolling mode**

In Overlay.tsx, wrap the Toolbar render in a mode gate so it does NOT render when `mode === "scrolling"`:

```tsx
{(mode === "committed") && (
  <Toolbar ... />
)}
```

(Adjust the condition to match existing logic — the Toolbar may already be gated by `mode === "committed"`.)

- [ ] **Step 4: Type check + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Overlay.tsx
git commit -m "feat(scroll): hide Toolbar during scrolling mode and trigger backend"
```

---

### Task 20: Restore main overlay on `capture:end`

**Files:**
- Modify: `src/routes/Overlay.tsx`

The main overlay must reset to `idle` once the backend ends the session (after scroll Copy/Save or Cancel). The backend already emits `capture:end`; the overlay already listens for it via existing IPC subscriptions. Verify nothing else is required.

- [ ] **Step 1: Verify the existing `onCaptureEnd` handler**

Run: `grep -n "onCaptureEnd\|capture:end" src/routes/Overlay.tsx`
Confirm it already calls `useOverlay.getState().end()` (or similar) to reset to idle. If not, wire it up:

```tsx
useEffect(() => {
  const unlistenP = onCaptureEnd(() => useOverlay.getState().end());
  return () => { unlistenP.then((u) => u()); };
}, []);
```

- [ ] **Step 2: Smoke check**

Add a `console.log("capture:end received")` inside the handler temporarily and run `pnpm tauri dev`. Trigger a regular screenshot copy and verify the log fires. Remove the log afterwards.

- [ ] **Step 3: Commit (if any change)**

```bash
git add src/routes/Overlay.tsx
git commit -m "chore(scroll): confirm overlay resets on capture:end"
```

(If no change was needed, skip this task.)

---

### Task 21 _(reserved — intentionally empty)_

Previously planned `ScrollStatusBar`, `ScrollPreview`, and `scroll-session.ts` orchestrator are merged into the chrome window in Phase 4 Task 24. This keeps the task numbering stable. Skip to Task 22.

---

### Task 22: Update `Toolbar.tsx` to wire `onScroll` and `selectionTooSmall`

**Files:**
- Modify: `src/overlay/Toolbar.tsx`

(Task 18 added the button shape; this task wires the new props end-to-end.)

- [ ] **Step 1: Confirm the props are threaded**

The Toolbar already accepts `onScroll` and `selectionTooSmall` from Task 18. Run:

```bash
grep -n "onScroll\|selectionTooSmall" src/overlay/Toolbar.tsx src/routes/Overlay.tsx
```

Expected: both props are defined in Toolbar.tsx props type and passed from Overlay.tsx (added in Task 19).

- [ ] **Step 2: TypeScript check + tests**

Run: `pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 3: Commit (if any drift)**

```bash
git add src/overlay/Toolbar.tsx src/routes/Overlay.tsx
git commit -m "chore(scroll): finalize Toolbar scroll integration"
```

---

## Phase 4 — Cross-platform passthrough (chrome-window strategy)

**Strategy decision:** Rather than punching a passthrough hole inside one overlay window (which requires NSView subclassing on macOS), we use a two-window pattern:

- The original `overlay-{monitor_id}` window is made **fully passthrough** during scroll mode — all mouse events go to the underlying app.
- A new `overlay-chrome-{monitor_id}` window is spawned for the status bar + preview strip. It is borderless, always-on-top, skip-taskbar, transparent, and positioned outside the selection rect so it can receive clicks normally.

### Task 23: Add `set_overlay_scroll_passthrough` command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register handler)

- [ ] **Step 1: Add the command**

Append to `src-tauri/src/commands.rs` near the other overlay-related commands:

```rust
#[tauri::command]
pub async fn set_overlay_scroll_passthrough(
    monitor_id: u32,
    enabled: bool,
    app: AppHandle,
) -> Result<(), String> {
    let label = format!("overlay-{monitor_id}");
    let window = app.get_webview_window(&label).ok_or("overlay window missing")?;

    #[cfg(target_os = "macos")]
    {
        // Tauri's set_ignore_cursor_events on a Webview window maps to
        // NSWindow setIgnoresMouseEvents on macOS — exactly what we want.
        window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // X11: Tauri's set_ignore_cursor_events uses XShape on X11.
        // Wayland: this is a no-op; documented limitation for v1.
        window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

(`set_ignore_cursor_events` is part of Tauri 2's `WebviewWindow` API and is already used elsewhere in the codebase — see `window_mgr.rs:79`.)

- [ ] **Step 2: Register in `generate_handler!`**

Add `commands::set_overlay_scroll_passthrough,` to the handler list in `src-tauri/src/lib.rs:231`.

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(scroll): cross-platform overlay passthrough toggle"
```

---

### Task 24: Spawn chrome window for status bar and preview

**Files:**
- Create: `src/routes/ScrollChrome.tsx`
- Modify: `src/main.tsx` (or routing root)
- Modify: `src-tauri/src/commands.rs` (`start_scroll_session` spawns the chrome; `stop_scroll_session` / `scroll_*` clean it up)
- Modify: `src-tauri/tauri.conf.json` if a window config block is needed (likely not — we build via `WebviewWindowBuilder` at runtime)

- [ ] **Step 1: Create the chrome route**

Create `src/routes/ScrollChrome.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom"; // adjust to your router
import type { ScrollProgress } from "@/lib/types";
import { onScrollProgress, scrollCopy, scrollSave, stopScrollSession } from "@/lib/ipc";

export function ScrollChrome() {
  const params = useParams<{ monitorId: string }>();
  const monitorId = Number(params.monitorId);
  const [progress, setProgress] = useState<ScrollProgress | null>(null);
  const [finalized, setFinalized] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const p = onScrollProgress((p) => setProgress(p));
    return () => { p.then((u) => u()); };
  }, []);

  const onDone = async () => {
    const r = await stopScrollSession(true);
    if (r) setFinalized({ width: r.width, height: r.height });
  };
  const onCancel = async () => {
    await stopScrollSession(false);
  };

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column", pointerEvents: "auto" }}>
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {progress?.previewDataUrl && (
          <img
            src={progress.previewDataUrl}
            alt=""
            style={{ position: "absolute", bottom: 0, left: 0, width: "100%" }}
          />
        )}
      </div>
      <div style={{
        padding: "8px 12px", background: "rgba(20,20,20,0.92)", color: "white",
        fontSize: 13, display: "flex", gap: 10, alignItems: "center",
      }}>
        {finalized ? (
          <>
            <span>{finalized.width}×{finalized.height}</span>
            <button onClick={() => scrollCopy()}>Copy</button>
            <button onClick={() => scrollSave()}>Save</button>
          </>
        ) : (
          <>
            <span>Stitching · {progress?.frames ?? 0} frames · {progress?.height ?? 0}px</span>
            <button onClick={onDone}>Done</button>
            <button onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
```

If your router doesn't use `react-router-dom`, parse the monitor ID directly from `window.location.hash` instead. The existing routes give the pattern — check `src/routes/Pin.tsx`.

- [ ] **Step 2: Register the route**

In your routing root (find via `grep -rn "Route\|createBrowserRouter\|HashRouter" src/main.tsx src/App.tsx`), add a route for `/scroll-chrome/:monitorId` that renders `<ScrollChrome />`. Follow the same pattern used by existing routes (`Pin.tsx`, `Settings.tsx`).

- [ ] **Step 3: Update `start_scroll_session` to spawn the chrome window**

In `src-tauri/src/commands.rs::start_scroll_session`, after computing `phys_rect` and before spawning the loop, add:

```rust
let chrome_label = format!("overlay-chrome-{monitor_id}");
if app.get_webview_window(&chrome_label).is_none() {
    use crate::capture::enumerate_monitors;
    let mon = enumerate_monitors()
        .ok()
        .and_then(|ms| ms.into_iter().find(|m| m.id == monitor_id))
        .ok_or("monitor not found for chrome window")?;

    // Strip width 80, height ~70% of selection, anchored to the right of the selection.
    // Falls back below if there's no room to the right.
    let strip_w = 80.0_f64;
    let strip_h = (phys_rect.height as f64 / mon.scale_factor as f64) * 0.7;
    let mon_logical_w = mon.rect.width as f64;
    let mon_logical_h = mon.rect.height as f64;
    let sel_logical_right = (phys_rect.x as f64 + phys_rect.width as f64) / mon.scale_factor as f64;
    let sel_logical_top = phys_rect.y as f64 / mon.scale_factor as f64;
    let mut x = mon.rect.x as f64 + sel_logical_right + 12.0;
    let mut y = mon.rect.y as f64 + sel_logical_top;
    if x + strip_w > mon.rect.x as f64 + mon_logical_w {
        x = mon.rect.x as f64 + 12.0;
        y = mon.rect.y as f64 + (mon_logical_h - strip_h - 12.0);
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        &chrome_label,
        tauri::WebviewUrl::App(format!("index.html#/scroll-chrome/{monitor_id}").into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .inner_size(strip_w, strip_h)
    .position(x, y)
    .build()
    .map_err(|e| e.to_string())?;
}

// Make the original overlay passthrough so the user can scroll the underlying app.
app.get_webview_window(&format!("overlay-{monitor_id}"))
    .and_then(|w| w.set_ignore_cursor_events(true).ok());
```

- [ ] **Step 4: Tear down the chrome window on session end**

The backend already knows the active monitor from `ScrollState.monitor_id`. Update `stop_scroll_session` (cancel branch), `scroll_copy`, and `scroll_save` to close the chrome window before ending the session.

Helper function in `src-tauri/src/commands.rs`:

```rust
fn close_scroll_chrome(app: &AppHandle, monitor_id: u32) {
    if let Some(w) = app.get_webview_window(&format!("overlay-chrome-{monitor_id}")) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(&format!("overlay-{monitor_id}")) {
        let _ = w.set_ignore_cursor_events(false);
    }
}
```

In `stop_scroll_session` cancel branch, before `mgr.end_session(&app)`:

```rust
if let Some(monitor_id) = mgr.scroll_ref(|s| s.monitor_id) {
    close_scroll_chrome(&app, monitor_id);
}
let _ = mgr.take_scroll();
mgr.end_session(&app);
```

In `scroll_copy` and `scroll_save`, before `mgr.end_session(&app)`, read the monitor_id first:

```rust
let monitor_id = mgr.scroll_ref(|s| s.monitor_id);
let img = mgr.take_scroll_result().ok_or("no scroll result available")?;
let _ = mgr.take_scroll();
if let Some(mid) = monitor_id { close_scroll_chrome(&app, mid); }
// ... existing logic continues
```

(The original Task 13 code already has `mgr.take_scroll_result()` then `mgr.take_scroll()` — insert the monitor_id read BEFORE the take calls so the state is still readable.)

**No TS changes** — the IPC wrappers in Task 16 remain parameter-free.

- [ ] **Step 5: Type check + build**

Run: `pnpm lint && pnpm build`
Run: `cd src-tauri && cargo check && cargo clippy -- -D warnings`
Expected: clean.

- [ ] **Step 6: Smoke test on macOS**

Run `pnpm tauri dev`. Capture → select a region on a long page → click Scroll button → verify:
- Original overlay outline is visible but mouse-transparent (you can scroll the underlying page).
- Chrome window with status bar + preview is visible to the right of (or below, on small monitors) the selection.
- Done / Cancel buttons in the chrome window work.

If preview thumb is empty: confirm `scroll:progress` events are firing (`console.log` in `onScrollProgress`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scroll): chrome window pattern for clickable status bar + preview"
```

---

### Task 25: Match-failed toast inside the chrome window

**Files:**
- Modify: `src/routes/ScrollChrome.tsx`

The chrome window has focus during scrolling (or at least is visible to the user), so the toast lives there.

- [ ] **Step 1: Add a toast to ScrollChrome**

Edit `src/routes/ScrollChrome.tsx`. Add at the top of the imports:

```tsx
import { onScrollMatchFailed } from "@/lib/ipc";
```

Inside the component, add:

```tsx
const [toast, setToast] = useState<string | null>(null);
useEffect(() => {
  const p = onScrollMatchFailed(({ consecutiveFailures }) => {
    if (consecutiveFailures >= 5) {
      setToast("Can't detect scroll — try scrolling more slowly.");
      window.setTimeout(() => setToast(null), 3000);
    }
  });
  return () => { p.then((u) => u()); };
}, []);
```

Render the toast inside the existing chrome JSX (above the status bar div):

```tsx
{toast && (
  <div style={{
    position: "absolute", top: 8, left: 8, right: 8,
    background: "rgba(220, 38, 38, 0.92)", color: "white",
    padding: "6px 10px", borderRadius: 6, fontSize: 12,
    textAlign: "center",
  }}>{toast}</div>
)}
```

- [ ] **Step 2: Type check + build**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/ScrollChrome.tsx
git commit -m "feat(scroll): match-failed toast in chrome window"
```

---

## Phase 5 — Validation

### Task 26: Run full Rust test + clippy + bench

- [ ] **Step 1: Tests**

Run: `cd src-tauri && cargo test`
Expected: all green.

- [ ] **Step 2: Clippy**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 3: Bench sanity**

Run: `cd src-tauri && cargo bench --bench scroll_stitch_bench -- --warm-up-time 1 --measurement-time 3`
Expected: `ingest_500x500` median < 5ms; `ingest_1000x1000` < 15ms.

- [ ] **Step 4: Commit nothing here — these are gates**

If any gate fails, the previous task is incomplete; loop back.

---

### Task 27: Frontend tests, lint, build

- [ ] **Step 1: Vitest**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: clean.

---

### Task 28: Manual smoke matrix

**Files:**
- Modify: `docs/smoke-matrix.md`

- [ ] **Step 1: Run the three smoke targets on macOS first**

For each: launch `pnpm tauri dev`, trigger capture, draw selection over the target, click the Scroll button, scroll the target with the mouse / trackpad, verify the stitched result via Copy → paste into Preview.app.

Targets:
1. Long web page in Chrome (e.g. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference).
2. Long PDF in Preview.app.
3. Slack scrollback in a busy channel.

- [ ] **Step 2: Document pass/fail per platform**

Update `docs/smoke-matrix.md`. Add a section:

```markdown
## Scrolling screenshot (v1)

| Target | macOS | Windows | Linux X11 |
|---|---|---|---|
| Long web page (Chrome) | ✅/❌ | ✅/❌ | ✅/❌ |
| Long PDF | ✅/❌ | ✅/❌ | ✅/❌ |
| Chat scrollback (Slack/Discord) | ✅/❌ | ✅/❌ | ✅/❌ |

Notes: <document any known issues>
```

- [ ] **Step 3: Commit**

```bash
git add docs/smoke-matrix.md
git commit -m "docs(scroll): smoke-test matrix for v1"
```

---

## Self-review checklist (DO THIS LAST)

Engineer or reviewing agent: before merging, walk this checklist:

- [ ] Every spec section in `2026-05-23-scrolling-screenshot-design.md` is implemented or explicitly deferred to Open Questions.
- [ ] No `TODO` or `unimplemented!` remains in shipped code (test scaffolding can keep them).
- [ ] All four new Tauri commands appear in `generate_handler!` in `lib.rs`.
- [ ] `Mode` enum is consistent in TS (`scrolling`, `scrollFinalized`) and reflected in `Overlay.tsx` render branches.
- [ ] `SessionGuard::drop` cancels active scroll sessions (verified in Task 14).
- [ ] Cross-platform passthrough is implemented on at least macOS + Windows; Linux is documented in smoke matrix if deferred.
- [ ] Rust clippy is clean with `-D warnings`.
- [ ] Stitched output for the smoke targets visually has no double-content or gaps.
