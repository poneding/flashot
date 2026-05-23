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

#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    /// `width × height` RGBA frame with a deterministic pseudo-random luminance
    /// per row. The `offset` shifts the pattern DOWN by `offset` rows: a row
    /// that was at y=0 with offset=0 appears at y=`offset` with offset=`offset`.
    /// Conceptually models content scrolling so that the previous frame's top
    /// ROI reappears `offset` rows lower in the new frame, allowing the matcher
    /// to recover the offset deterministically.
    fn gradient_frame(width: u32, height: u32, offset: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            // Splitmix-style hash on (y - offset) for a unique, discriminative
            // per-row luminance. Mean-centered NCC requires a non-monotonic
            // signal to avoid the linear-ramp degeneracy.
            let key = (y as i64).wrapping_sub(offset as i64) as u64;
            let mut h = key.wrapping_mul(0x9E37_79B9_7F4A_7C15);
            h ^= h >> 30;
            h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
            h ^= h >> 27;
            let l = (h & 0xff) as u8;
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
        // Frame B has the same content shifted DOWN by 37 rows: prev's top
        // ROI [0..50] reappears at curr[37..87]. The matcher should recover 37.
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
