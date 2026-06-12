//! Benchmarks for the scroll-capture preview pipeline.
//!
//! Pure CPU (no display server needed), but intentionally NOT run in CI —
//! CI only runs `crop_bench`. Run locally with:
//! `cd src-tauri && cargo bench --bench scroll_stitch_bench`
//!
//! `preview_full` is the legacy `preview_stitched(640, 8192)` call the
//! session loop used to make on every progress emit: its cost grows linearly
//! with the stitched height. `preview_tail` is the bounded-cost replacement
//! (`preview_tail(640, 1024)`) that encodes only the bottom strip the chrome
//! window can actually display.

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use flashot_lib::scroll_stitch::{IngestResult, ScrollStitcher, StitchConfig};

const WIDTH: u32 = 1280;
const FRAME_H: u32 = 800;
/// Rows gained per synthetic ingest: large enough to grow the canvas
/// quickly, small enough to leave a solid overlap for the NCC matcher.
const SCROLL_STEP: u32 = 400;

/// `width x height` RGBA frame whose row `y` carries a hash-derived signal
/// for "document row `content_start + y`" (same scheme as the scroll_stitch
/// unit tests), additionally mixed with the column index so pixels vary
/// horizontally too. The row signal gives the NCC matcher unambiguous
/// structure — a plain linear ramp correlates equally well at every offset
/// and is never accepted as a scroll — while the per-pixel variation keeps
/// PNG encoding honest (constant-color rows compress almost for free and
/// would hide the real encode cost of screen content).
fn gradient_frame(width: u32, height: u32, content_start: u32) -> Vec<u8> {
    let mut v = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let content_row = (content_start + y) as u64;
        let mut h = content_row.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        h ^= h >> 30;
        h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h ^= h >> 27;
        for x in 0..width {
            let p = h ^ (x as u64).wrapping_mul(0x94D0_49BB_1331_11EB);
            let l = (p & 0xff) as u8;
            v.extend_from_slice(&[l, l, l, 255]);
        }
    }
    v
}

/// Drive a stitcher to at least `target_height` by repeatedly ingesting
/// synthetic scrolled frames, exactly like the live capture loop grows the
/// canvas. Returns the stitcher plus the content offset of the last accepted
/// frame so callers can reproduce the steady-state "same frame again" tick.
fn stitcher_at_height(target_height: u32) -> (ScrollStitcher, u32) {
    let mut stitcher = ScrollStitcher::new(
        WIDTH,
        FRAME_H,
        gradient_frame(WIDTH, FRAME_H, 0),
        StitchConfig::default(),
    );
    let mut content_start = 0u32;
    while stitcher.height() < target_height {
        content_start += SCROLL_STEP;
        match stitcher.ingest(&gradient_frame(WIDTH, FRAME_H, content_start)) {
            IngestResult::Appended { .. } => {}
            other => panic!("synthetic frame was not accepted: {other:?}"),
        }
    }
    (stitcher, content_start)
}

fn bench_previews(c: &mut Criterion) {
    let mut group = c.benchmark_group("scroll_preview");
    // Full-canvas previews of tall captures take hundreds of ms per
    // iteration; keep the sample count small so the suite stays usable.
    group.sample_size(10);

    for target_height in [2_000u32, 10_000, 30_000] {
        let (stitcher, _) = stitcher_at_height(target_height);
        let height = stitcher.height();

        group.bench_function(format!("full_640x8192/h{height}"), |b| {
            b.iter(|| black_box(stitcher.preview_stitched(black_box(640), black_box(8192))))
        });
        group.bench_function(format!("tail_640x1024/h{height}"), |b| {
            b.iter(|| black_box(stitcher.preview_tail(black_box(640), black_box(1024))))
        });
    }

    group.finish();
}

fn bench_ingest(c: &mut Criterion) {
    // Steady-state cost of one capture tick on a ~5_000 px canvas. The frame
    // matches the previous one (`NoChange`), which still pays the full NCC
    // matching cost — an accepted frame differs only by a strip memcpy.
    let (mut stitcher, content_start) = stitcher_at_height(5_000);
    let frame = gradient_frame(WIDTH, FRAME_H, content_start);
    assert_eq!(stitcher.ingest(&frame), IngestResult::NoChange);

    c.bench_function("scroll_ingest/1280x800_at_h5000", |b| {
        b.iter(|| black_box(stitcher.ingest(black_box(&frame))))
    });
}

criterion_group!(benches, bench_previews, bench_ingest);
criterion_main!(benches);
