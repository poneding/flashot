# Linux Phase 1: Window Detection & Wayland Clipboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable X11 window detection on Linux and Wayland clipboard support so the overlay shows window boundaries for snap-to-window selection.

**Architecture:** Use `xcap::Window::all()` to enumerate X11 windows, map them to `WindowRect`, and degrade gracefully (empty list + warning log) when X11 is unavailable (pure Wayland). Add arboard's `wayland-data-control` feature for clipboard on Wayland.

**Tech Stack:** Rust, xcap 0.9, arboard 3, Tauri 2, GitHub Actions

---

## File Map

| File | Role |
|------|------|
| `src-tauri/src/window_probe/linux.rs` | X11 window enumeration via xcap |
| `src-tauri/src/lib.rs` | Graceful error handling for window enumeration |
| `src-tauri/Cargo.toml` | Add arboard wayland-data-control feature |
| `.github/workflows/ci.yml` | Add libwayland-dev to Ubuntu deps |
| `.github/workflows/release.yml` | Add libwayland-dev to Ubuntu deps |

---

## Task 1: Implement Linux window enumeration

**Files:**
- Modify: `src-tauri/src/window_probe/linux.rs` (replace entire file)

- [ ] **Step 1: Replace the stub implementation**

Replace the contents of `src-tauri/src/window_probe/linux.rs` with:

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

- [ ] **Step 2: Verify compilation on Windows (cross-check no breakage)**

Run: `cd src-tauri && cargo check`

Expected: Compiles successfully (linux.rs is gated behind `#[cfg(target_os = "linux")]` so it won't be compiled on Windows, but cargo check ensures no syntax errors in other modified files).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window_probe/linux.rs
git commit -m "feat(linux): implement window enumeration via xcap"
```

---

## Task 2: Graceful error handling for window enumeration

**Files:**
- Modify: `src-tauri/src/lib.rs:307-310`

- [ ] **Step 1: Change error propagation to graceful degradation**

In `src-tauri/src/lib.rs`, replace lines 307-310:

```rust
    let windows = windows_result
        .context("Window enumeration task panicked")?
        .context("Failed to enumerate windows")?;
    tracing::info!("run_capture: enumerated {} windows", windows.len());
```

With:

```rust
    let windows = match windows_result {
        Ok(Ok(ws)) => {
            tracing::info!("run_capture: enumerated {} windows", ws.len());
            ws
        }
        Ok(Err(e)) => {
            tracing::warn!("Window enumeration failed, proceeding without window detection: {e}");
            Vec::new()
        }
        Err(e) => {
            tracing::warn!("Window enumeration task panicked: {e}");
            Vec::new()
        }
    };
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check`

Expected: Compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix(linux): degrade gracefully when window enumeration fails"
```

---

## Task 3: Enable arboard Wayland clipboard support

**Files:**
- Modify: `src-tauri/Cargo.toml:52`

- [ ] **Step 1: Update arboard dependency**

In `src-tauri/Cargo.toml`, replace line 52:

```toml
arboard = "3"
```

With:

```toml
arboard = { version = "3", features = ["wayland-data-control"] }
```

- [ ] **Step 2: Verify compilation and update lockfile**

Run: `cd src-tauri && cargo check`

Expected: Compiles successfully. Cargo.lock will be updated with wayland-data-control transitive dependencies.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(linux): enable wayland clipboard via arboard wayland-data-control"
```

---

## Task 4: Update CI dependencies

**Files:**
- Modify: `.github/workflows/ci.yml:45`
- Modify: `.github/workflows/release.yml:127`

- [ ] **Step 1: Add libwayland-dev to CI workflow**

In `.github/workflows/ci.yml`, replace line 45:

```yaml
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libpipewire-0.3-dev
```

With:

```yaml
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libpipewire-0.3-dev libwayland-dev
```

- [ ] **Step 2: Add libwayland-dev to release workflow**

In `.github/workflows/release.yml`, replace line 127:

```yaml
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

With:

```yaml
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libpipewire-0.3-dev libwayland-dev
```

Note: The release workflow was also missing `libpipewire-0.3-dev` — adding it here for consistency with CI.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: add libwayland-dev to Ubuntu build dependencies"
```

---

## Task 5: Push and verify CI

- [ ] **Step 1: Push to remote**

```bash
git push origin dev
```

- [ ] **Step 2: Verify CI passes**

Check GitHub Actions at `https://github.com/poneding/flashot/actions` — all three platforms (Ubuntu, macOS, Windows) should pass `cargo check`, `cargo clippy`, and `cargo test`.

- [ ] **Step 3: Update release tag (optional, if testing release)**

If you want to re-test the release workflow:

```bash
git tag -f v0.1.0-alpha.1
git push origin v0.1.0-alpha.1 --force
```
