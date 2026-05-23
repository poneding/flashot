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
            |mut s| {
                let _ = s.ingest(black_box(&next));
            },
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
            |mut s| {
                let _ = s.ingest(black_box(&next));
            },
            criterion::BatchSize::SmallInput,
        )
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
