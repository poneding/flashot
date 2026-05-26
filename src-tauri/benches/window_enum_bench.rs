use criterion::{criterion_group, criterion_main, Criterion};
use flashot_lib::window_probe::enumerate;

fn bench(c: &mut Criterion) {
    if std::env::var("CI").is_ok() {
        return;
    }
    c.bench_function("window_enumerate", |b| {
        b.iter(|| {
            let _ = enumerate();
        })
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
