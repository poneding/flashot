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

    pub fn ingest(&mut self, frame_rgba: &[u8]) -> IngestResult {
        debug_assert_eq!(
            frame_rgba.len(),
            (self.width * self.frame_height * 4) as usize,
            "ingest frame size mismatch"
        );

        // Direction: we target scroll-DOWN (user scrolling forward through long
        // content, new pixels appearing at the bottom of the viewport). Under
        // scroll-DOWN the NEW frame's top ROI is what's still present in the
        // OLD frame, shifted *downward* by dy rows. So we use `frame_rgba` as the
        // template source and `last_frame` as the search image; the returned
        // dy is the number of pixels by which the content scrolled.
        let (dy, score) = column_match_ncc(
            frame_rgba,            // template_source: take its top ROI
            &self.last_frame,      // search_image: look for the ROI here
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

        // Append rows [frame_height - dy .. frame_height] from the new frame
        // (the bottom `dy` rows — the freshly-revealed content).
        let strip_start = ((self.frame_height - dy) * self.width) as usize * 4;
        let strip_end = (self.frame_height * self.width) as usize * 4;
        let new_total_height = self.height + dy;

        if new_total_height > self.config.max_height_px {
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

    pub fn finalize(self) -> StitchedImage {
        StitchedImage {
            rgba: self.canvas,
            width: self.width,
            height: self.height,
        }
    }

    pub fn preview_thumbnail(&self, target_height_px: u32) -> Vec<u8> {
        use image::{
            codecs::png::PngEncoder, imageops::FilterType, ExtendedColorType, ImageBuffer,
            ImageEncoder, RgbaImage,
        };

        let src: RgbaImage =
            ImageBuffer::from_raw(self.width, self.height, self.canvas.clone())
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

    /// `width × height` RGBA frame whose row `y` carries a hash-derived luminance
    /// of "document row `content_start + y`". Scrolling DOWN by N pixels means
    /// `content_start` increases by N — the new frame's top ROI then appears
    /// `N` rows below the old frame's top.
    fn gradient_frame(width: u32, height: u32, content_start: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let content_row = (content_start + y) as u64;
            let mut h = content_row.wrapping_mul(0x9E37_79B9_7F4A_7C15);
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
        // prev was at content row 37 (further down the document).
        // curr is at content row 0 (user scrolled UP by 37 rows).
        // prev's top ROI [0..50] = content rows [37..87].
        // In curr (which starts at content row 0), these rows live at y=37..87.
        let prev = gradient_frame(width, frame_height, 37);
        let curr = gradient_frame(width, frame_height, 0);

        let (best_y, score) = column_match_ncc(
            &prev, &curr, width, frame_height,
            0, 50, 9,
        );

        assert!(
            (best_y as i32 - 37).abs() <= 1,
            "expected dy ≈ 37, got {best_y}"
        );
        assert!(score > 0.95, "score too low: {score}");
    }

    #[test]
    fn ingest_appends_new_strip_for_known_scroll() {
        let width = 80;
        let frame_h = 600;
        // initial captures content rows [0..600].
        let initial = gradient_frame(width, frame_h, 0);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        // After scrolling DOWN by 37, next captures content rows [37..637].
        let next = gradient_frame(width, frame_h, 37);
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

    #[test]
    fn max_height_caps_canvas_growth() {
        // Use frame_h=200 so the default 50-row ROI has full overlap with the
        // last_frame search image after a 60-row scroll (avoids matcher edge
        // effects that would otherwise reduce the NCC score below threshold).
        let width = 80;
        let frame_h = 200;
        let initial = gradient_frame(width, frame_h, 0);
        // Tight cap so we hit it after one ingest: 200 + 60 > 250.
        let config = StitchConfig { max_height_px: 250, ..StitchConfig::default() };
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, config);

        // Frame scrolled 60 rows -> would push height to 260 (> cap 250).
        let next = gradient_frame(width, frame_h, 60);
        let r = stitcher.ingest(&next);
        assert_eq!(r, IngestResult::MaxHeightReached);
        assert_eq!(stitcher.height(), 250);
        assert_eq!(stitcher.canvas.len(), (width * 250 * 4) as usize);
    }

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
        assert!(thumb.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&thumb).unwrap().to_rgba8();
        assert!(decoded.height() <= 200);
        assert!(decoded.height() > 0);
    }

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
}
