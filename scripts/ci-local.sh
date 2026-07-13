#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TAURI_DIR="$ROOT/src-tauri"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 127
  fi
}

require_cmd cargo
require_cmd pnpm

run pnpm lint
run pnpm test
run cargo check --manifest-path "$TAURI_DIR/Cargo.toml" --all-targets
run cargo clippy --manifest-path "$TAURI_DIR/Cargo.toml" --all-targets -- -D warnings
run cargo test --manifest-path "$TAURI_DIR/Cargo.toml"
run cargo bench --manifest-path "$TAURI_DIR/Cargo.toml" --bench crop_bench

SMOKE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/flashot-ci-smoke.XXXXXX")"
trap 'rm -rf "$SMOKE_ROOT"' EXIT

LINUX_SMOKE="$SMOKE_ROOT/linux-ashpd"
mkdir -p "$LINUX_SMOKE/src"
cat >"$LINUX_SMOKE/Cargo.toml" <<'TOML'
[package]
name = "flashot-linux-ashpd-smoke"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
ashpd = { version = "=0.13.11", features = ["screenshot"] }
urlencoding = "2"
TOML
cat >"$LINUX_SMOKE/src/lib.rs" <<RS
mod portal_uri {
    include!("$TAURI_DIR/src/capture/portal_uri.rs");
}

pub fn ashpd_screenshot_uri_api_compiles() -> anyhow::Result<std::path::PathBuf> {
    let _request = ashpd::desktop::screenshot::Screenshot::request();
    let uri = ashpd::Uri::parse("file:///tmp/Flashot%20Shot.png")?;
    portal_uri::portal_screenshot_uri_to_path(uri.as_str())
}
RS
run cargo check --manifest-path "$LINUX_SMOKE/Cargo.toml" --target x86_64-unknown-linux-gnu

if rustup target list --installed | grep -qx 'x86_64-pc-windows-msvc'; then
  WINDOWS_SMOKE="$SMOKE_ROOT/windows-probe"
  mkdir -p "$WINDOWS_SMOKE/src"
  cat >"$WINDOWS_SMOKE/Cargo.toml" <<'TOML'
[package]
name = "flashot-windows-probe-smoke"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_UI_WindowsAndMessaging",
  "Win32_Graphics_Gdi",
  "Win32_Graphics_Dwm",
  "Win32_System_ProcessStatus",
  "Win32_System_Threading",
] }
TOML
  cat >"$WINDOWS_SMOKE/src/lib.rs" <<RS
pub mod types {
    #[derive(Clone, Debug, PartialEq)]
    pub struct Rect {
        pub x: i32,
        pub y: i32,
        pub width: u32,
        pub height: u32,
    }

    #[derive(Clone, Debug, PartialEq)]
    pub struct WindowRect {
        pub rect: Rect,
        pub title: String,
        pub app_name: String,
        pub pid: u32,
    }
}

pub mod window_probe_windows {
    include!("$TAURI_DIR/src/window_probe/windows.rs");
}
RS
  run cargo check --manifest-path "$WINDOWS_SMOKE/Cargo.toml" --target x86_64-pc-windows-msvc
else
  echo "skipping Windows smoke check: x86_64-pc-windows-msvc target is not installed" >&2
fi
