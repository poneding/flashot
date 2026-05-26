use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn make_4k_frame() -> Vec<u8> {
    let w = 3840u32;
    let h = 2160u32;
    vec![128u8; (w * h * 4) as usize]
}

fn crop_rgba(
    src: &[u8],
    src_width: u32,
    rect_x: u32,
    rect_y: u32,
    rect_w: u32,
    rect_h: u32,
) -> Vec<u8> {
    let mut out = Vec::with_capacity((rect_w * rect_h * 4) as usize);
    for row in 0..rect_h {
        let src_row_start = ((rect_y + row) * src_width + rect_x) as usize * 4;
        let src_row_end = src_row_start + (rect_w as usize) * 4;
        out.extend_from_slice(&src[src_row_start..src_row_end]);
    }
    out
}

fn bench(c: &mut Criterion) {
    let frame = make_4k_frame();
    c.bench_function("crop_4k_rect_1080p", |b| {
        b.iter(|| {
            let _ = crop_rgba(black_box(&frame), 3840, 100, 100, 1920, 1080);
        })
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
