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
