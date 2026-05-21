# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flashot is a fast, cross-platform screenshot tool built with Tauri 2 + React + TypeScript. It captures screens via global hotkey, displays an overlay for region selection, and copies or saves the result.

**Key architectural pattern**: The app uses a **session-based capture model** with RAII guards. When the hotkey fires, Rust captures all monitors into frozen frames, spawns overlay windows (one per monitor), and holds a `SessionGuard`. The guard's drop automatically cleans up overlays and frames, ensuring no resource leaks even on error paths.

## Development Commands

### Frontend

```bash
pnpm dev              # Run Vite dev server (frontend only)
pnpm build            # Build frontend for production
pnpm test             # Run Vitest tests
pnpm test:watch       # Run tests in watch mode
pnpm lint             # TypeScript type checking
```

### Rust Backend

```bash
cd src-tauri
cargo check           # Fast compile check
cargo clippy          # Linting (must pass with -D warnings)
cargo test            # Run unit tests
cargo bench           # Run all benchmarks
cargo bench --bench crop_bench  # Run specific benchmark
cargo build --release # Production build
```

### Full App

```bash
pnpm tauri dev        # Run full app in dev mode
pnpm tauri build      # Build production bundle (.dmg, .msi, .AppImage)
```

## Architecture

### Capture Flow (Rust → Frontend → Rust)

1. **Hotkey trigger** (`src-tauri/src/lib.rs:run_capture`)
   - Captures all monitors in parallel with `xcap`
   - Enumerates windows with platform-specific APIs
   - Saves frames as PNGs in app cache dir
   - Emits `capture:start` event to each overlay window with frame URL + window rects

2. **Overlay interaction** (`src/routes/Overlay.tsx` + `src/overlay/state.ts`)
   - Zustand store manages state machine: `idle → hover → dragging → committed`
   - Mouse events drive state transitions
   - Custom crosshair cursor (`src/overlay/Crosshair.tsx`) uses CSS transforms for hardware-accelerated rendering
   - Native cursor is hidden in `hover` and `dragging` modes to prevent double cursor display
   - Window detection uses z-order hit-testing (`src/lib/hit-test.ts`)
   - Selection handles use geometry utilities (`src/lib/geometry.ts`)

3. **Crop & output** (`src-tauri/src/commands.rs`)
   - Frontend calls `cropAndCopy` or `cropAndSave` with monitor ID + rect
   - Rust retrieves frozen frame from `WindowMgr`, crops with scale factor, outputs to clipboard/file
   - `SessionGuard` drop cleans up overlays and frames

### Key Rust Modules

- **`window_mgr.rs`**: Session lifecycle manager. `SessionGuard` is RAII — drop always calls `end()` to hide overlays and clear frames. Never manually manage session state.
- **`capture/`**: Platform-specific screen capture (macOS uses `xcap`, Windows uses `xcap` + Win32 APIs)
- **`window_probe/`**: Platform-specific window enumeration (macOS: Core Graphics, Windows: Win32)
- **`hotkey.rs`**: Global hotkey registration with live updates on settings change
- **`commands.rs`**: Tauri command handlers. All commands receive `State<Arc<WindowMgr>>` to access frozen frames.

### Key Frontend Modules

- **`src/overlay/state.ts`**: Zustand store for overlay state machine. All overlay components read from this store.
- **`src/overlay/Crosshair.tsx`**: Custom crosshair cursor component. Uses CSS `transform` with `willChange: "transform"` for GPU-accelerated rendering. Displays a 20px crosshair (10px per side) with a centered circle. Designed for future color picker integration.
- **`src/lib/geometry.ts`**: Pure functions for rect operations (clamp, resize, translate). Used by selection handles.
- **`src/lib/hit-test.ts`**: Z-order window hit-testing. Returns topmost window at cursor position.
- **`src/lib/ipc.ts`**: Typed wrappers around Tauri IPC (commands + events). Use these instead of raw `invoke()`.

### Multi-Monitor Handling

Each monitor gets its own overlay window (label: `overlay-{monitor_id}`). The overlay route listens for `capture:start` events, which include:

- `monitorId`: Which monitor this overlay belongs to
- `frameUrl`: `asset://` URL to the frozen screenshot PNG
- `windows`: Array of window rects translated to monitor-local coordinates

When the user selects a region, the frontend sends the monitor ID + rect to Rust. Rust looks up the frozen frame by monitor ID and crops it.

### Settings Persistence

Settings are stored via `tauri-plugin-store` in JSON format. When settings change:

1. Frontend calls `setSettings` command
2. Rust saves to disk and emits `settings:changed` event
3. Hotkey service listens for this event and re-registers the hotkey

This allows live hotkey updates without app restart.

## Testing

### Frontend Tests

- Located in `src/__tests__/`
- Use Vitest + React Testing Library
- Focus on pure logic (geometry, hit-testing)
- Run with `pnpm test`

### Rust Tests

- Unit tests inline with modules (e.g., `window_mgr.rs` has `#[cfg(test)] mod tests`)
- Run with `cd src-tauri && cargo test`

### Benchmarks

- Located in `src-tauri/benches/`
- `crop_bench`: Pure CPU cropping (runs in CI)
- `capture_bench`, `window_enum_bench`, `clipboard_bench`: Require display server (skip in CI)
- Run with `cd src-tauri && cargo bench`

## Platform-Specific Notes

### macOS

- Requires screen recording permission (checked at startup in `permission.rs`)
- Uses `macOSPrivateApi: true` in `tauri.conf.json` for overlay rendering
- Window enumeration uses Core Graphics (`CGWindowListCopyWindowInfo`)

### Windows

- Window enumeration uses Win32 APIs (`EnumWindows`, `GetWindowRect`)
- No special permissions required

### Linux

- X11 recommended (Wayland support experimental)
- Window enumeration uses X11 APIs
- Tray icon may not work on all desktop environments

## Common Patterns

### Adding a new Tauri command

1. Add function to `src-tauri/src/commands.rs` with `#[tauri::command]`
2. Register in `tauri::generate_handler![]` in `src-tauri/src/lib.rs`
3. Add typed wrapper to `src/lib/ipc.ts`
4. Call from frontend via the wrapper

### Adding a new overlay component

1. Create component in `src/overlay/`
2. Read state from `useOverlay` hook (from `src/overlay/state.ts`)
3. Add to `src/routes/Overlay.tsx` render tree
4. Component should be absolutely positioned and pointer-events-aware
5. For cursor-following elements, use CSS `transform` instead of `left/top` for better performance

### Modifying capture flow

- **Never** manually hide overlays or clear frames — always use `SessionGuard`
- Frozen frames are cloned on retrieval (see `WindowMgr::frame`) to prevent mutation
- Scale factor must be applied when cropping (see `commands.rs:crop_rgba`)

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push/PR:

- `cargo check`, `cargo clippy -D warnings`, `cargo test`
- `cargo bench --bench crop_bench` (only bench that works without display)
- Runs on macOS, Windows, Linux (Ubuntu)

## Git Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/) specification for all commit messages:

### Format

```txt
<type>: <description>

[optional body]

[optional footer]
```

### Types

- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation changes
- **style**: Code style changes (formatting, missing semicolons, etc.)
- **refactor**: Code refactoring without changing functionality
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks (dependencies, build config, CI, etc.)
- **ci**: CI/CD configuration changes

### Examples

```bash
feat: add color picker to crosshair cursor
fix: resolve memory leak in session cleanup
refactor: extract window detection logic to separate module
chore: update dependencies to latest versions
ci: add libpipewire-0.3-dev to Ubuntu build
docs: update CLAUDE.md with commit conventions
```

### Guidelines

- Use lowercase for type and description
- Keep the first line under 72 characters
- Use imperative mood ("add" not "added" or "adds")
- Reference issues/PRs in the footer when applicable
- Use the body to explain *what* and *why*, not *how*

## Performance Targets

- Crop operation: < 8ms (measured by `crop_bench`, currently ~748µs)
- Capture latency: < 200ms (subjective, not benchmarked)
- Overlay render: 60fps (React + CSS transforms with GPU acceleration)
- Crosshair cursor: Real-time tracking via `onMouseMove` events, hardware-accelerated via CSS `transform`
