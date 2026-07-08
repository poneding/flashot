# Flashot Makefile
#
# Works on Windows, macOS, and Linux with GNU Make (3.81+).
# Windows: install make via `choco install make`, `scoop install make`,
# or GnuWin32. Recipes are single-line commands that are valid under both
# cmd.exe and sh, and use `cargo --manifest-path` instead of `cd` so no
# recipe depends on shell-specific behavior.
#
# Main targets: check, lint, test, build, run

CARGO_MANIFEST = src-tauri/Cargo.toml

help:
	@echo Flashot make targets:
	@echo   make check      - fast compile checks: tsc + cargo check
	@echo   make lint       - tsc + cargo clippy with -D warnings
	@echo   make test       - frontend vitest + Rust cargo test
	@echo   make test-web   - frontend vitest only
	@echo   make test-rust  - Rust cargo test only
	@echo   make build      - production bundle via pnpm tauri build
	@echo   make build-web  - frontend production build only
	@echo   make run        - full app in dev mode via pnpm tauri dev
	@echo   make dev        - frontend Vite dev server only
	@echo   make bench      - Rust crop_bench benchmark
	@echo   make ci         - check + lint + test + bench, mirrors CI
	@echo   make clean      - remove cargo target dir and frontend dist

check:
	pnpm lint
	cargo check --manifest-path $(CARGO_MANIFEST) --all-targets

lint:
	pnpm lint
	cargo clippy --manifest-path $(CARGO_MANIFEST) --all-targets -- -D warnings

test: test-web test-rust

test-web:
	pnpm test

test-rust:
	cargo test --manifest-path $(CARGO_MANIFEST)

build:
	pnpm tauri build

build-web:
	pnpm build

run:
	pnpm tauri dev

dev:
	pnpm dev

bench:
	cargo bench --manifest-path $(CARGO_MANIFEST) --bench crop_bench

ci: check lint test bench

clean:
	cargo clean --manifest-path $(CARGO_MANIFEST)
	node -e "require('fs').rmSync('dist',{recursive:true,force:true})"

.PHONY: help check lint test test-web test-rust build build-web run dev bench ci clean
