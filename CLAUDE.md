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
   - Zustand store manages state machine: `idle → hover → dragging → committed` (plus `locked`, `scrollStarting`, `scrolling` for multi-monitor locking and scroll capture)
   - Mouse events drive state transitions
   - Cursor handling: the overlay sets a CSS cursor and mirrors it natively via `webviewWindow.setCursorIcon` (`src/routes/Overlay.tsx`); cursor position is polled via `src/lib/cursor.ts`; on macOS a native `NSCursor` crosshair is also pushed when overlays are shown (`src-tauri/src/overlay_window.rs`, final push in `lib.rs:run_capture`)
   - Window detection uses z-order hit-testing (`src/lib/hit-test.ts`)
   - Selection handles use geometry utilities (`src/lib/geometry.ts`)

3. **Crop & output** (`src-tauri/src/commands.rs`)
   - Frontend calls `cropAndCopy` or `cropAndSave` with monitor ID + rect
   - Rust retrieves frozen frame from `WindowMgr`, crops with scale factor, outputs to clipboard/file
   - `SessionGuard` drop cleans up overlays and frames

### Key Rust Modules

- **`window_mgr.rs`**: Session lifecycle manager. `SessionGuard` is RAII — drop always calls `end()` to hide overlays and clear frames. Never manually manage session state.
- **`overlay_window.rs`**: Platform-specific overlay window configuration/show. On macOS, capture overlays are shown per-monitor with `orderFrontRegardless`; also pushes the native `NSCursor` crosshair at overlay show (`push_capture_cursor`). Flashot itself is activated once after all overlays are up (see `app_activation::activate_flashot_for_capture`) so the crosshair is honored.
- **`app_activation.rs`**: macOS focus management. Captures the previously-frontmost app (`capture_previous_frontmost_app`), activates Flashot for capture (`activate_flashot_for_capture`), and restores focus by reactivating the previous app — `reactivate_previous_app` (borrow, for scroll mid-session) and `reactivate_then_hide_overlays_macos` (reactivate then hide overlays, atomically on the main thread at session end).
- **`scroll_session.rs`**: Tokio capture loop for scroll capture. Recaptures the selected region on a tick, feeds the stitcher, and emits throttled progress events (with a bottom-tail preview PNG) to the chrome window only.
- **`scroll_stitch.rs`**: Incremental scroll stitcher. Matches adjacent frames via normalized cross-correlation (NCC) on feature-sampled ROIs and appends only the newly scrolled strip to the canvas.
- **`capture/`**: Platform-specific screen capture (all platforms use `xcap`)
- **`window_probe/`**: Platform-specific window enumeration (macOS: Core Graphics, Windows: Win32, Linux: X11)
- **`hotkey.rs`**: Global hotkey registration with live updates on settings change. Also owns session-scoped hotkeys (Esc cancel; color picker X/C) registered only while a capture session is active.
- **`commands.rs`**: Tauri command handlers. Capture-related commands receive `State<Arc<WindowMgr>>` to access frozen frames.
- **`pin_mgr.rs`**: Pin image lifecycle manager. Tracks active pin windows and their associated PNG files in app cache. Each pin gets a UUID, an independent always-on-top transparent window, and is removed via `close_pin`.
- **`mask.rs`**: Rounded-corner alpha masking for captured RGBA buffers.
- **`image_adjust.rs`**: Pixel-level image adjustments applied to crops before output.
- **`saver.rs`**: Save dialog, PNG encoding to disk, last-save-dir bookkeeping.
- **`settings_store.rs`**: `Settings` struct + JSON load/save (`<config>/flashot/settings.json`).
- **`clipboard.rs`**: Copies RGBA images to the system clipboard.
- **`tray.rs`**: Tray icon and localized menu.
- **`i18n.rs`**: Native-side localized strings (tray menu, utility window titles).
- **`permission.rs`**: Best-effort first-launch macOS screen-recording permission probe.

### Key Frontend Modules

- **`src/overlay/state.ts`**: Zustand store for overlay state machine. All overlay components read from this store.
- **`src/annotation/`**: Konva-based annotation editor (used in the overlay and pin windows). `types.ts` is the data model, `store.ts` is a Zustand store with a command stack for undo/redo, `Stage.tsx` is the canvas interaction layer, `tools/` holds per-type modules (e.g. `marker.ts` — split badge + label connected by a leader line; `blur.ts` — mosaic/gaussian/solid/smart-erase modes), `render.ts` dispatches objects to Konva nodes, `export.ts` exports the stage to PNG.
- **`src/lib/geometry.ts`**: Pure functions for rect operations (clamp, resize, translate). Used by selection handles.
- **`src/lib/hit-test.ts`**: Z-order window hit-testing. Returns topmost window at cursor position.
- **`src/lib/cursor.ts`**: One-shot global-cursor read — converts the global cursor point to window-local coordinates (the 50 ms polling loop lives in `Overlay.tsx`).
- **`src/lib/ipc.ts`**: Typed wrappers around Tauri IPC (commands + events). Use these instead of raw `invoke()`.
- **`src/routes/Pin.tsx`**: Pin window route. Displays a pinned screenshot in an always-on-top borderless window. Mouse drag moves the window via `startDragging()`, scroll wheel scales (50%–300%), double-click and Escape close the pin.
- **`src/routes/ScrollChrome.tsx`**: Scroll-capture chrome window. Shows the live progress preview, a check button that finishes the capture into a pin, and auto-pins when the stitcher reaches max height (both paths funnel through one guarded `finishPin`).
- **`src/overlay/ColorPicker.tsx`**: Snipaste-style color picker overlay. Loads the frozen frame into an offscreen canvas, reads a 15×15 pixel block around the cursor on each move, renders a 120×120 magnifier with grid lines and center highlight. X toggles HEX/RGB format; C copies the color value.
- **`src/i18n/`**: Frontend translations (`en`, `zh-CN`, `zh-TW`).

### Multi-Monitor Handling

Each monitor gets its own overlay window (label: `overlay-{monitor_id}`). The overlay route listens for `capture:start` events, which include:

- `monitorId`: Which monitor this overlay belongs to
- `frameUrl`: `asset://` URL to the frozen screenshot PNG
- `windows`: Array of window rects translated to monitor-local coordinates

When the user selects a region, the frontend sends the monitor ID + rect to Rust. Rust looks up the frozen frame by monitor ID and crops it.

### Settings Persistence

Settings are persisted by `src-tauri/src/settings_store.rs` as a JSON file in the OS config dir (`<config>/flashot/settings.json`). When settings change:

1. Frontend calls `setSettings` command
2. Rust saves to disk and emits `settings:changed` event
3. Hotkey service listens for this event and re-registers the hotkey

This allows live hotkey updates without app restart.

## Testing

### Frontend Tests

- Located in `src/__tests__/`
- Use Vitest + React Testing Library
- Cover pure logic (geometry, hit-testing, annotation tools) and component/route behavior (overlay, settings, scroll chrome, pin)
- Run with `pnpm test`

### Rust Tests

- Unit tests inline with modules (e.g., `window_mgr.rs` has `#[cfg(test)] mod tests`)
- Run with `cd src-tauri && cargo test`

### Benchmarks

- Located in `src-tauri/benches/`
- `crop_bench`: Pure CPU cropping (runs in CI)
- `scroll_stitch_bench`: Pure CPU scroll stitching + preview encode (not in CI)
- `capture_bench`, `window_enum_bench`, `clipboard_bench`: Require display server (skip in CI)
- Run with `cd src-tauri && cargo bench`

## Platform-Specific Notes

### macOS

- Requires screen recording permission (checked at startup in `permission.rs`)
- Uses `macOSPrivateApi: true` in `tauri.conf.json` for overlay rendering
- Window enumeration uses Core Graphics (`CGWindowListCopyWindowInfo`)

**macOS capture window management** (load-bearing invariants, pinned by guard tests in `overlay_window.rs`, `app_activation.rs`, `window_mgr.rs`, and `commands.rs`):

- Flashot's utility windows (Settings/About/Updater) are **permanently pinned** to the floating window level the moment they are shown (`commands.rs::pin_utility_window_to_level`, set via the stable `setLevel:` AppKit call — never `orderOut:`/`orderFront:`, which throw NSExceptions on windows mid-interaction and crashed the app). Priority by level (higher = further front): Pin (FLOATING+3) > Updater (+2) > Settings (+1) > About (FLOATING). Because they are already pinned front, activating Flashot during capture never visibly bumps/reshuffles them — no flicker, no "jump to top after capture" bug. They stay open-and-pinned; the user closes them manually when done.
- The app that was frontmost when the capture hotkey fired is captured (`app_activation::capture_previous_frontmost_app`) into the session state BEFORE Flashot activates itself, so it can be reactivated on session end to return focus to the app the user was in.
- Capture overlays are shown per-monitor with `orderFrontRegardless` (no per-window activation), then Flashot is activated ONCE (`app_activation::activate_flashot_for_capture`) after every overlay already covers its monitor. Activation is required because macOS only honors the cursor of the frontmost app, so the overlay crosshair never stuck under the old "never activate" model. Utility windows are already pinned, so activation does not visibly reshuffle them.
- Session end reactivates the previously-frontmost app (NSRunningApplication `activateWithOptions: AllWindows | IgnoringOtherApps`) BEFORE hiding overlays, atomically in one main-thread task (`app_activation::reactivate_then_hide_overlays_macos`), which returns focus to the user's previous app. `reactivate_previous_app` BLOCKS until the main-thread task completes (a fire-and-forget version would drop the retained `NSRunningApplication` before `activateWithOptions` dereferences it, crashing via a dangling pointer). `crop_and_save` keeps Flashot active across its save dialog, then calls `WindowMgr::restore_focus_to_previous_app` to reactivate the previous app.
- scroll capture reactivates the underlying app mid-session (`WindowMgr::reactivate_previous_app`, which borrows the handle) so wheel events reach the underlying app; scroll end then goes through the normal session-end reactivate-and-hide path.
- Because overlay windows never take Tauri focus (`capture_overlay_should_take_focus() == false` on macOS) and keyboard focus is not relied upon, session shortcuts (Esc, and X/C for the color picker) are session-scoped GLOBAL hotkeys (`hotkey.rs`); X/C are disabled during annotation text input so they can be typed (Esc remains active).
- The crosshair cursor is pushed natively via `NSCursor` at overlay show plus a post-loop backstop (`push_capture_cursor`); it is only visible because Flashot is frontmost during capture (see activation above).

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
- `cargo bench --bench crop_bench` (the only bench CI runs; `scroll_stitch_bench` is also display-free but not enabled)
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
- Scroll progress preview: flat-cost encode — the emitted preview is a bottom tail sized to the chrome viewport, not the full canvas (measured by `scroll_stitch_bench`)
