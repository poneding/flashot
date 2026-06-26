# Keep recipes shell-portable for GNU Make on Windows, macOS, and Linux.
PNPM ?= pnpm
CARGO ?= cargo
TAURI_MANIFEST := src-tauri/Cargo.toml

.DEFAULT_GOAL := help

.PHONY: help install check lint run build test test-watch frontend-lint frontend-build cargo-check cargo-clippy cargo-test cargo-bench tauri-dev tauri-build docs-run docs-build docs-preview

help:
	@echo Available targets:
	@echo make install - Install project dependencies
	@echo make check - Run frontend and Rust checks
	@echo make lint - Run TypeScript and Rust lint checks
	@echo make run - Run the full Tauri app in dev mode
	@echo make build - Build the production Tauri app
	@echo make test - Run frontend and Rust tests
	@echo make frontend-build - Build the frontend only
	@echo make cargo-bench - Run the crop benchmark

install:
	$(PNPM) install

check: lint test cargo-check

lint: frontend-lint cargo-clippy

run: tauri-dev

build: tauri-build

test:
	$(PNPM) test
	$(CARGO) test --manifest-path $(TAURI_MANIFEST)

test-watch:
	$(PNPM) test:watch

frontend-lint:
	$(PNPM) lint

frontend-build:
	$(PNPM) build

cargo-check:
	$(CARGO) check --manifest-path $(TAURI_MANIFEST) --all-targets

cargo-clippy:
	$(CARGO) clippy --manifest-path $(TAURI_MANIFEST) --all-targets -- -D warnings

cargo-test:
	$(CARGO) test --manifest-path $(TAURI_MANIFEST)

cargo-bench:
	$(CARGO) bench --manifest-path $(TAURI_MANIFEST) --bench crop_bench

tauri-dev:
	$(PNPM) tauri dev

tauri-build:
	$(PNPM) tauri build

docs-run:
	$(PNPM) docs:dev

docs-build:
	$(PNPM) docs:build

docs-preview:
	$(PNPM) docs:preview
