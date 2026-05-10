use criterion::{criterion_group, criterion_main, Criterion};
use flashot_lib::capture::capture_all_monitors;

fn bench(c: &mut Criterion) {
    // Skip on CI runners that lack a display server
    if std::env::var("CI").is_ok() && std::env::var("DISPLAY").is_err() {
        return;
    }
    c.bench_function("capture_all_monitors", |b| b.iter(|| { let _ = capture_all_monitors(); }));
}

criterion_group!(benches, bench);
criterion_main!(benches);
