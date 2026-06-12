//! Incremental stitcher for scrolling screenshots.
//!
//! Each `ingest()` call receives a fresh capture of the same on-screen rect
//! and decides how much of it is *new* (i.e. has scrolled into view since the
//! previous frame) by matching feature-sampled ROIs between adjacent frames.
//! The new strip is appended to an accumulating RGBA canvas which is consumed
//! via `finalize()`.

#[derive(Clone, Copy, Debug)]
pub struct StitchConfig {
    pub sample_columns: usize,
    pub roi_rows: u32,
    pub min_match_score: f32,
    pub max_height_px: u32,
}

impl Default for StitchConfig {
    fn default() -> Self {
        Self {
            sample_columns: 9,
            roi_rows: 50,
            min_match_score: 0.85,
            max_height_px: 32_768,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum IngestResult {
    Appended {
        new_height: u32,
        dy: u32,
        score: f32,
    },
    NoChange,
    MatchFailed {
        score: f32,
    },
    MaxHeightReached,
}

#[derive(Clone, Copy, Debug)]
struct MatchCandidate {
    dy: u32,
    score: f32,
    trusted_positive: bool,
}

#[derive(Clone, Copy, Debug)]
struct BandMatch {
    dy: u32,
    score: f32,
    moving_bands: usize,
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
    accepted_frames: u32,
    config: StitchConfig,
}

impl ScrollStitcher {
    pub fn new(
        width: u32,
        frame_height: u32,
        initial_frame: Vec<u8>,
        config: StitchConfig,
    ) -> Self {
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
            accepted_frames: 0,
            config,
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn frame_count(&self) -> u32 {
        self.accepted_frames + 1
    }

    pub fn canvas_bytes_clone(&self) -> Vec<u8> {
        self.canvas.clone()
    }

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
        let (dy, score) = self.match_scroll_delta(frame_rgba);

        if score < self.config.min_match_score {
            return IngestResult::MatchFailed { score };
        }

        if dy == 0 {
            // Don't replace last_frame on no-change; we want to keep the
            // canonical reference so a tiny redraw blip doesn't accumulate.
            return IngestResult::NoChange;
        }

        // Append rows [frame_height - dy .. frame_height] from the new frame
        // (the bottom `dy` rows — the freshly-revealed content).
        let strip_start = ((self.frame_height - dy) * self.width) as usize * 4;
        let strip_end = (self.frame_height * self.width) as usize * 4;
        let new_total_height = self.height + dy;

        if new_total_height > self.config.max_height_px {
            let allowed_dy = self.config.max_height_px - self.height;
            let truncated_start = ((self.frame_height - allowed_dy) * self.width) as usize * 4;
            self.canvas
                .extend_from_slice(&frame_rgba[truncated_start..strip_end]);
            self.height = self.config.max_height_px;
            self.accepted_frames += 1;
            self.last_frame.copy_from_slice(frame_rgba);
            return IngestResult::MaxHeightReached;
        }

        self.canvas
            .extend_from_slice(&frame_rgba[strip_start..strip_end]);
        self.height = new_total_height;
        self.accepted_frames += 1;
        self.last_frame.copy_from_slice(frame_rgba);

        IngestResult::Appended {
            new_height: self.height,
            dy,
            score,
        }
    }

    fn match_scroll_delta(&self, frame_rgba: &[u8]) -> (u32, f32) {
        let roi_rows = self.config.roi_rows.clamp(1, self.frame_height);
        let sample_columns = self.config.sample_columns.max(1);
        let mut best_any = (0, f32::MIN);
        let mut best_positive: Option<MatchCandidate> = None;

        for offset in self.match_offsets(roi_rows) {
            let band_candidate = band_match_ncc(
                frame_rgba,       // template_source: take its ROI
                &self.last_frame, // search_image: look for the ROI here
                self.width,
                self.frame_height,
                offset,
                roi_rows,
                sample_columns,
            );
            Self::consider_match(
                &mut best_any,
                &mut best_positive,
                self.config.min_match_score,
                MatchCandidate {
                    dy: band_candidate.dy,
                    score: band_candidate.score,
                    trusted_positive: band_candidate.moving_bands >= 2,
                },
            );

            let candidate = column_match_ncc(
                frame_rgba,       // template_source: take its ROI
                &self.last_frame, // search_image: look for the ROI here
                self.width,
                self.frame_height,
                offset,
                roi_rows,
                sample_columns,
            );
            Self::consider_match(
                &mut best_any,
                &mut best_positive,
                self.config.min_match_score,
                MatchCandidate {
                    dy: candidate.0,
                    score: candidate.1,
                    trusted_positive: false,
                },
            );
        }

        if let Some(positive) = best_positive {
            if positive.trusted_positive || best_any.0 == 0 || positive.score + 0.02 >= best_any.1 {
                return (positive.dy, positive.score);
            }
        }

        best_any
    }

    fn consider_match(
        best_any: &mut (u32, f32),
        best_positive: &mut Option<MatchCandidate>,
        min_match_score: f32,
        candidate: MatchCandidate,
    ) {
        if candidate.score > best_any.1 {
            *best_any = (candidate.dy, candidate.score);
        }
        if candidate.dy > 0
            && candidate.score >= min_match_score
            && best_positive.is_none_or(|best| {
                candidate.trusted_positive && !best.trusted_positive
                    || candidate.trusted_positive == best.trusted_positive
                        && candidate.score > best.score
            })
        {
            *best_positive = Some(candidate);
        }
    }

    fn match_offsets(&self, roi_rows: u32) -> Vec<u32> {
        let max_offset = self.frame_height.saturating_sub(roi_rows);
        let mut offsets = [
            self.static_drop_offset,
            self.config.roi_rows,
            self.config.roi_rows.saturating_mul(2),
            self.frame_height / 3,
        ]
        .into_iter()
        .filter(|offset| *offset <= max_offset)
        .collect::<Vec<_>>();
        offsets.sort_unstable();
        offsets.dedup();
        offsets
    }

    pub fn finalize(self) -> StitchedImage {
        StitchedImage {
            rgba: self.canvas,
            width: self.width,
            height: self.height,
        }
    }

    /// Encode a PNG preview of only the bottom strip ("tail") of the canvas.
    ///
    /// The output is `target_width_px` wide. When the canvas is taller than
    /// the tail window, the bottom `width * max_tail_height_px /
    /// target_width_px` source rows are rendered into a `target_width_px x
    /// max_tail_height_px` image. When the canvas is shorter, the whole
    /// canvas is rendered and the output height *shrinks* so the aspect
    /// ratio is always preserved (no vertical stretching).
    ///
    /// Unlike a full-canvas preview, the cost of this encoder is bounded by
    /// the tail window and stays flat as the stitched canvas grows.
    pub fn preview_tail(&self, target_width_px: u32, max_tail_height_px: u32) -> Vec<u8> {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ExtendedColorType, ImageEncoder};

        let target_w = target_width_px.max(1);
        let max_tail_h = max_tail_height_px.max(1);
        let crop_h = ((self.width as u64 * max_tail_h as u64).div_ceil(target_w as u64))
            .clamp(1, self.height as u64) as u32;
        let crop_y = self.height - crop_h;
        let out_h = ((crop_h as u64 * target_w as u64 / self.width as u64).max(1))
            .min(u32::MAX as u64) as u32;
        let mut scaled = Vec::with_capacity(target_w as usize * out_h as usize * 4);

        for y in 0..out_h {
            let src_y = crop_y
                + ((y as u64 * crop_h as u64) / out_h as u64)
                    .min(crop_h.saturating_sub(1) as u64) as u32;
            for x in 0..target_w {
                let src_x = ((x as u64 * self.width as u64) / target_w as u64)
                    .min(self.width.saturating_sub(1) as u64) as u32;
                let idx = ((src_y * self.width + src_x) as usize) * 4;
                scaled.extend_from_slice(&self.canvas[idx..idx + 4]);
            }
        }

        let mut buf = Vec::new();
        // Fast compression: this PNG lives for one progress tick in the
        // chrome preview, so encode speed matters and size does not.
        PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Adaptive)
            .write_image(&scaled, target_w, out_h, ExtendedColorType::Rgba8)
            .expect("PNG encode");
        buf
    }

    /// Encode a PNG preview of the *entire* stitched canvas, downscaled to
    /// `target_width_px` wide (capped at `max_height_px` tall).
    ///
    /// Cost grows linearly with the stitched height, which is why the live
    /// session emits [`Self::preview_tail`] instead. Retained as the
    /// baseline for `benches/scroll_stitch_bench.rs`.
    pub fn preview_stitched(&self, target_width_px: u32, max_height_px: u32) -> Vec<u8> {
        use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};

        let target_w = target_width_px.max(1);
        let max_h = max_height_px.max(1);
        let natural_h = ((self.height as u64 * target_w as u64).div_ceil(self.width as u64))
            .clamp(1, u32::MAX as u64) as u32;
        let target_h = natural_h.min(max_h).max(1);
        let mut scaled = Vec::with_capacity((target_w * target_h * 4) as usize);

        for y in 0..target_h {
            let src_y = ((y as u64 * self.height as u64) / target_h as u64)
                .min(self.height.saturating_sub(1) as u64) as u32;
            for x in 0..target_w {
                let src_x = ((x as u64 * self.width as u64) / target_w as u64)
                    .min(self.width.saturating_sub(1) as u64) as u32;
                let idx = ((src_y * self.width + src_x) as usize) * 4;
                scaled.extend_from_slice(&self.canvas[idx..idx + 4]);
            }
        }

        let mut buf = Vec::new();
        PngEncoder::new(&mut buf)
            .write_image(&scaled, target_w, target_h, ExtendedColorType::Rgba8)
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

fn band_match_ncc(
    prev: &[u8],
    curr: &[u8],
    width: u32,
    height: u32,
    static_drop_offset: u32,
    roi_rows: u32,
    sample_columns: usize,
) -> BandMatch {
    debug_assert_eq!(prev.len(), (width * height * 4) as usize);
    debug_assert_eq!(curr.len(), (width * height * 4) as usize);
    debug_assert!(static_drop_offset + roi_rows <= height);

    let band_count = horizontal_band_count(width, sample_columns);
    let bands = horizontal_bands(width, band_count);
    let prev_features = extract_horizontal_band_features(prev, width, height, &bands);
    let curr_features = extract_horizontal_band_features(curr, width, height, &bands);

    let moving_bands = select_feature_bands(
        &prev_features,
        &curr_features,
        band_count,
        static_drop_offset,
        roi_rows,
        true,
    );
    let moving_band_count = moving_bands.len();
    let selected_bands = if moving_band_count >= 2 {
        moving_bands
    } else {
        select_feature_bands(
            &prev_features,
            &curr_features,
            band_count,
            static_drop_offset,
            roi_rows,
            false,
        )
    };
    let selected_bands = if selected_bands.is_empty() {
        (0..band_count).collect::<Vec<_>>()
    } else {
        selected_bands
    };

    let (dy, score) = feature_strip_match_ncc(
        &prev_features,
        &curr_features,
        band_count,
        &selected_bands,
        height,
        static_drop_offset,
        roi_rows,
    );

    BandMatch {
        dy,
        score,
        moving_bands: moving_band_count,
    }
}

fn horizontal_band_count(width: u32, sample_columns: usize) -> usize {
    let desired = sample_columns.saturating_mul(2).clamp(8, 24);
    desired.min(width.max(1) as usize)
}

fn horizontal_bands(width: u32, band_count: usize) -> Vec<(u32, u32)> {
    let width = width.max(1);
    (0..band_count)
        .map(|i| {
            let start = (i as u32 * width) / band_count as u32;
            let end = (((i + 1) as u32 * width) / band_count as u32)
                .max(start + 1)
                .min(width);
            (start, end)
        })
        .collect()
}

fn extract_horizontal_band_features(
    rgba: &[u8],
    width: u32,
    height: u32,
    bands: &[(u32, u32)],
) -> Vec<f32> {
    let mut out = Vec::with_capacity(height as usize * bands.len());
    for y in 0..height {
        for &(start, end) in bands {
            let span = end.saturating_sub(start).max(1);
            let samples = span.min(12);
            let mut sum = 0.0f32;
            for i in 0..samples {
                let x_offset = (((i * span) + span / 2) / samples).min(span - 1);
                sum += luma_at(rgba, width, start + x_offset, y);
            }
            out.push(sum / samples as f32);
        }
    }
    out
}

fn select_feature_bands(
    prev_features: &[f32],
    curr_features: &[f32],
    band_count: usize,
    y_start: u32,
    rows: u32,
    require_movement: bool,
) -> Vec<usize> {
    const MIN_VARIANCE: f32 = 0.75;
    const MIN_MOVEMENT: f32 = 0.75;

    let mut scored = Vec::new();
    for band in 0..band_count {
        let (variance, movement) = band_feature_stats(
            prev_features,
            curr_features,
            band_count,
            band,
            y_start,
            rows,
        );
        if variance >= MIN_VARIANCE && (!require_movement || movement >= MIN_MOVEMENT) {
            scored.push((band, variance * (1.0 + movement)));
        }
    }

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(band_count.min(12));
    scored.sort_unstable_by_key(|(band, _)| *band);
    scored.into_iter().map(|(band, _)| band).collect()
}

fn band_feature_stats(
    prev_features: &[f32],
    curr_features: &[f32],
    band_count: usize,
    band: usize,
    y_start: u32,
    rows: u32,
) -> (f32, f32) {
    let mut sum = 0.0f32;
    let mut movement = 0.0f32;
    for row in 0..rows {
        let idx = ((y_start + row) as usize * band_count) + band;
        let value = prev_features[idx];
        sum += value;
        movement += (value - curr_features[idx]).abs();
    }

    let mean = sum / rows as f32;
    let mut variance = 0.0f32;
    for row in 0..rows {
        let idx = ((y_start + row) as usize * band_count) + band;
        let delta = prev_features[idx] - mean;
        variance += delta * delta;
    }

    (variance / rows as f32, movement / rows as f32)
}

fn feature_strip_match_ncc(
    template_features: &[f32],
    search_features: &[f32],
    band_count: usize,
    selected_bands: &[usize],
    height: u32,
    static_drop_offset: u32,
    roi_rows: u32,
) -> (u32, f32) {
    let template = extract_feature_strip(
        template_features,
        band_count,
        selected_bands,
        static_drop_offset,
        roi_rows,
    );
    let t_mean = template.iter().sum::<f32>() / template.len() as f32;
    let t_demean: Vec<f32> = template.iter().map(|v| v - t_mean).collect();
    let t_norm = t_demean.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-6);

    let max_y = height.saturating_sub(roi_rows);
    let mut best_y = static_drop_offset;
    let mut best_score = f32::MIN;

    for y in static_drop_offset..=max_y {
        let c_mean = feature_strip_mean(search_features, band_count, selected_bands, y, roi_rows);
        let mut dot = 0.0f32;
        let mut c_sq = 0.0f32;
        let mut i = 0usize;
        for row in 0..roi_rows {
            let base = (y + row) as usize * band_count;
            for &band in selected_bands {
                let cd = search_features[base + band] - c_mean;
                dot += t_demean[i] * cd;
                c_sq += cd * cd;
                i += 1;
            }
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

fn extract_feature_strip(
    features: &[f32],
    band_count: usize,
    selected_bands: &[usize],
    y_start: u32,
    rows: u32,
) -> Vec<f32> {
    let mut out = Vec::with_capacity(selected_bands.len() * rows as usize);
    for row in 0..rows {
        let base = (y_start + row) as usize * band_count;
        for &band in selected_bands {
            out.push(features[base + band]);
        }
    }
    out
}

fn feature_strip_mean(
    features: &[f32],
    band_count: usize,
    selected_bands: &[usize],
    y_start: u32,
    rows: u32,
) -> f32 {
    let mut sum = 0.0f32;
    for row in 0..rows {
        let base = (y_start + row) as usize * band_count;
        for &band in selected_bands {
            sum += features[base + band];
        }
    }
    sum / (selected_bands.len() * rows as usize) as f32
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
        for &x in cols {
            out.push(luma_at(rgba, width, x, y));
        }
    }
    out
}

fn luma_at(rgba: &[u8], width: u32, x: u32, y: u32) -> f32 {
    let p = ((y * width + x) as usize) * 4;
    // Rec. 601 luma; good enough for matching.
    let r = rgba[p] as f32;
    let g = rgba[p + 1] as f32;
    let b = rgba[p + 2] as f32;
    0.299 * r + 0.587 * g + 0.114 * b
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

        let (best_y, score) = column_match_ncc(&prev, &curr, width, frame_height, 0, 50, 9);

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
            IngestResult::Appended {
                new_height,
                dy,
                score,
            } => {
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
    fn identical_frames_before_first_scroll_do_not_trigger_end_of_scroll() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let mut stitcher =
            ScrollStitcher::new(width, frame_h, initial.clone(), StitchConfig::default());

        // The capture loop starts before the user has time to scroll. Identical
        // frames before the first accepted movement must not auto-finish the
        // session, otherwise scroll capture ends after ~300ms.
        for i in 0..10 {
            let r = stitcher.ingest(&initial);
            assert_eq!(r, IngestResult::NoChange, "iteration {i}");
        }
    }

    #[test]
    fn repeated_identical_frames_after_scroll_do_not_trigger_end_of_scroll() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let next = gradient_frame(width, frame_h, 37);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        assert!(matches!(
            stitcher.ingest(&next),
            IngestResult::Appended { .. }
        ));

        for i in 0..40 {
            let r = stitcher.ingest(&next);
            assert_eq!(r, IngestResult::NoChange, "iteration {i}");
        }
    }

    #[test]
    fn short_pause_between_scroll_ticks_does_not_trigger_end_of_scroll() {
        let width = 80;
        let frame_h = 600;
        let initial = gradient_frame(width, frame_h, 0);
        let next = gradient_frame(width, frame_h, 37);
        let after_pause = gradient_frame(width, frame_h, 74);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        assert!(matches!(
            stitcher.ingest(&next),
            IngestResult::Appended { .. }
        ));

        for i in 0..10 {
            let r = stitcher.ingest(&next);
            assert_eq!(r, IngestResult::NoChange, "pause frame {i}");
        }

        assert!(
            matches!(stitcher.ingest(&after_pause), IngestResult::Appended { .. }),
            "scrolling after a brief pause should still be accepted"
        );
    }

    fn frame_with_static_header(
        width: u32,
        height: u32,
        header_rows: u32,
        content_start: u32,
    ) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let l = if y < header_rows {
                42
            } else {
                let content_row = (content_start + y - header_rows) as u64;
                let mut h = content_row.wrapping_mul(0x9E37_79B9_7F4A_7C15);
                h ^= h >> 30;
                h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
                (h & 0xff) as u8
            };
            for _ in 0..width {
                v.extend_from_slice(&[l, l, l, 255]);
            }
        }
        v
    }

    fn frame_with_static_sidebars_and_narrow_content(
        width: u32,
        height: u32,
        content_start: u32,
    ) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            for x in 0..width {
                let l = if x < 78 {
                    ((y.wrapping_mul(17) + x.wrapping_mul(31)) % 190 + 35) as u8
                } else if (126..141).contains(&x) {
                    let content_row = (content_start + y) as u64;
                    let mut h = content_row.wrapping_mul(0x9E37_79B9_7F4A_7C15);
                    h ^= h >> 30;
                    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
                    h ^= (x as u64).wrapping_mul(0x94D0_49BB_1331_11EB);
                    (h & 0xff) as u8
                } else {
                    245
                };
                v.extend_from_slice(&[l, l, l, 255]);
            }
        }
        v
    }

    #[test]
    fn ingest_uses_lower_roi_when_top_rows_are_static() {
        let width = 80;
        let frame_h = 240;
        let header_rows = 70;
        let initial = frame_with_static_header(width, frame_h, header_rows, 0);
        let next = frame_with_static_header(width, frame_h, header_rows, 37);
        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());

        match stitcher.ingest(&next) {
            IngestResult::Appended { dy, score, .. } => {
                assert!((dy as i32 - 37).abs() <= 1, "dy={dy}");
                assert!(score > 0.95, "score too low: {score}");
            }
            other => panic!("expected Appended through static header, got {other:?}"),
        }
    }

    #[test]
    fn ingest_uses_moving_area_when_legacy_columns_are_static_or_blank() {
        let width = 240;
        let frame_h = 220;
        let initial = frame_with_static_sidebars_and_narrow_content(width, frame_h, 0);
        let next = frame_with_static_sidebars_and_narrow_content(width, frame_h, 37);

        let legacy = column_match_ncc(&next, &initial, width, frame_h, 0, 50, 9);
        assert_eq!(
            legacy.0, 0,
            "legacy column matcher should be dominated by static/blank columns in this layout",
        );

        let mut stitcher = ScrollStitcher::new(width, frame_h, initial, StitchConfig::default());
        match stitcher.ingest(&next) {
            IngestResult::Appended { dy, score, .. } => {
                assert!((dy as i32 - 37).abs() <= 1, "dy={dy}");
                assert!(score > 0.85, "score too low: {score}");
            }
            other => panic!("expected Appended through moving-area matcher, got {other:?}"),
        }
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
        let config = StitchConfig {
            max_height_px: 250,
            ..StitchConfig::default()
        };
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
            width,
            frame_h,
            gradient_frame(width, frame_h, 0),
            StitchConfig::default(),
        );
        let img = stitcher.finalize();
        assert_eq!(img.width, width);
        assert_eq!(img.height, frame_h);
        assert_eq!(img.rgba.len(), (width * frame_h * 4) as usize);
    }

    #[test]
    fn preview_tail_renders_a_crisp_panel_sized_view_of_the_bottom_strip() {
        let width = 80;
        let frame_h = 800;
        let canvas = gradient_frame(width, frame_h, 0);
        let stitcher =
            ScrollStitcher::new(width, frame_h, canvas.clone(), StitchConfig::default());
        let thumb = stitcher.preview_tail(640, 360);
        assert!(thumb.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&thumb).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 640);
        assert_eq!(decoded.height(), 360);

        // The tail must be anchored to the BOTTOM of the canvas: with
        // crop_h = ceil(80 * 360 / 640) = 45, the first output row samples
        // canvas row 800 - 45 = 755, not row 0.
        let crop_y = 755usize;
        let expected = canvas[crop_y * width as usize * 4];
        assert_eq!(decoded.get_pixel(0, 0)[0], expected);
    }

    #[test]
    fn preview_tail_preserves_aspect_when_canvas_is_shorter_than_tail() {
        let width = 80;
        let frame_h = 800;
        let stitcher = ScrollStitcher::new(
            width,
            frame_h,
            gradient_frame(width, frame_h, 0),
            StitchConfig::default(),
        );

        // Tail window (80 * 1000 / 40 = 2000 rows) exceeds the 800-row
        // canvas, so the output height must SHRINK to 800 * 40 / 80 = 400
        // instead of stretching the canvas to fill 1000 rows.
        let preview = stitcher.preview_tail(40, 1000);
        assert!(preview.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&preview).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 40);
        assert_eq!(decoded.height(), 400);
    }

    #[test]
    fn preview_stitched_preserves_full_canvas_height_ratio() {
        let width = 80;
        let frame_h = 800;
        let stitcher = ScrollStitcher::new(
            width,
            frame_h,
            gradient_frame(width, frame_h, 0),
            StitchConfig::default(),
        );

        let preview = stitcher.preview_stitched(40, 1000);
        assert!(preview.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&preview).unwrap().to_rgba8();
        assert_eq!(decoded.width(), 40);
        assert_eq!(decoded.height(), 400);
    }

    #[test]
    fn preview_tail_avoids_full_canvas_clone() {
        let source = include_str!("scroll_stitch.rs").replace("\r\n", "\n");
        let start = source.find("pub fn preview_tail").unwrap();
        let end = source[start..]
            .find("pub fn preview_stitched")
            .map(|idx| start + idx)
            .unwrap();
        let body = &source[start..end];

        assert!(
            !body.contains("self.canvas.clone()"),
            "preview generation should not clone the full stitched canvas",
        );
        assert!(
            !body.contains("imageops::resize"),
            "preview generation should downsample directly into a thumbnail buffer",
        );
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
