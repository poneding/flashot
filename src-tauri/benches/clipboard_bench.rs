use criterion::{criterion_group, criterion_main, Criterion};
use flashot_lib::clipboard::copy_image;

fn bench(c: &mut Criterion) {
    if std::env::var("CI").is_ok() && std::env::var("DISPLAY").is_err() {
        return;
    }
    let w = 1920u32;
    let h = 1080u32;
    let rgba = vec![200u8; (w * h * 4) as usize];
    c.bench_function("clipboard_copy_image_1080p", |b| {
        b.iter(|| { let _ = copy_image(rgba.clone(), w, h); })
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
