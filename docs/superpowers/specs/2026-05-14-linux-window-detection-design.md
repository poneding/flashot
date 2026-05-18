# Linux Phase 1: Window Detection & Wayland Clipboard

## Overview

Add X11 window detection to the Linux build using `xcap::Window::all()`, and enable Wayland clipboard support via arboard's `wayland-data-control` feature. This completes Linux Phase 1: full region capture + window snap on X11, region-only capture on Wayland.

## Scope

- Window enumeration on X11 via xcap public API
- Graceful degradation on Wayland (empty window list, capture still works)
- Wayland clipboard support via arboard feature flag
- CI dependency updates

## Non-Goals

- Wayland-native window enumeration (compositor-specific IPC)
- Window detection on GNOME Wayland (no practical API available)
- Global hotkey on Wayland (not supported by `global-hotkey` crate)

## Design

### 1. `src-tauri/src/window_probe/linux.rs`

Replace the empty stub with xcap-based enumeration:

```rust
use crate::types::{Rect, WindowRect};
use anyhow::{Context, Result};
use xcap::Window;

pub fn enumerate() -> Result<Vec<WindowRect>> {
    let windows = Window::all().context("Failed to enumerate windows via X11")?;

    let mut out = Vec::new();
    for win in windows {
        if win.is_minimized().unwrap_or(false) {
            continue;
        }
        let x = win.x().unwrap_or(0);
        let y = win.y().unwrap_or(0);
        let width = win.width().unwrap_or(0);
        let height = win.height().unwrap_or(0);
        if width < 2 || height < 2 {
            continue;
        }

        out.push(WindowRect {
            rect: Rect { x, y, width, height },
            title: win.title().unwrap_or_default(),
            app_name: win.app_name().unwrap_or_default(),
            pid: win.pid().unwrap_or(0),
        });
    }
    Ok(out)
}
```

Key behaviors:
- `Window::all()` returns windows in front-to-back z-order (consistent with macOS/Windows)
- Minimized windows and windows < 2px are filtered out
- Individual property failures use defaults rather than aborting enumeration

### 2. Error Handling in `src-tauri/src/lib.rs`

Window enumeration failure must not block the capture session. At the call site where `window_probe::enumerate` is spawned, catch errors and degrade to an empty list with a warning log:

```rust
// If window enumeration fails (e.g., pure Wayland), use empty list
let windows = match window_result {
    Ok(ws) => ws,
    Err(e) => {
        tracing::warn!("Window enumeration failed, proceeding without window detection: {e}");
        Vec::new()
    }
};
```

### 3. `src-tauri/Cargo.toml` — arboard Feature

```toml
arboard = { version = "3", features = ["wayland-data-control"] }
```

Enables clipboard access on Wayland via `wlr-data-control` protocol. No code changes needed — arboard auto-detects the display server.

### 4. CI Dependencies

Add `libwayland-dev` to Ubuntu apt-get in both workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

## Platform Behavior Matrix

| Feature | X11 | Wayland | Notes |
|---------|-----|---------|-------|
| Screen capture | Works | Works | xcap handles both |
| Window detection | Works | Empty list | Graceful fallback |
| Clipboard | Works | Works | With wayland-data-control |
| Global hotkey | Works | No | Limitation of global-hotkey crate |
| System tray | Works | Works | Tauri handles this |

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/window_probe/linux.rs` | Replace stub with xcap enumeration |
| `src-tauri/src/lib.rs` | Degrade window enumeration errors to warning + empty list |
| `src-tauri/Cargo.toml` | Add `wayland-data-control` feature to arboard |
| `.github/workflows/ci.yml` | Add `libwayland-dev` to Ubuntu deps |
| `.github/workflows/release.yml` | Add `libwayland-dev` to Ubuntu deps |

## Testing

- Unit test: not practical (requires X11 display server)
- CI: verify compilation passes on Ubuntu
- Manual: test on X11 desktop that window rects appear in overlay
