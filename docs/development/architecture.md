# Architecture

Flashot follows a **hybrid architecture** with a Rust backend driving capture, cropping, and clipboard operations, and a React frontend handling the overlay UI, annotation, and interaction.

## Session-Based Capture Model

The core architectural pattern is a **session-based capture model** with RAII (Resource Acquisition Is Initialization) guards.

```
Hotkey trigger
     │
     ▼
Capture all monitors (xcap) ──► Window enumeration
     │                                     │
     ▼                                     │
Save frames as PNGs in cache dir           │
     │                                     │
     ▼                                     ▼
Spawn overlay windows ──────────────────► Window rects
(one per monitor)        │                    │
     │                   │                    │
     ▼                   ▼                    ▼
SessionGuard created ──► Emit capture:start event
     │                       with frames + windows
     ▼
User interacts with overlay
     │
     ▼
Crop & output (copy/save/pin)
     │
     ▼
SessionGuard dropped ──► Cleanup overlays & frames
```

### SessionGuard

`SessionGuard` is the critical safety mechanism. When a capture session starts:

1. `WindowMgr::start()` freezes all frames and spawns overlay windows.
2. A `SessionGuard` is returned — as long as it's held, the session is active.
3. When `SessionGuard` is **dropped** (on session end or error), it automatically:
   - Hides and closes all overlay windows
   - Clears all frozen frames from memory
   - Releases the session lock

This RAII approach guarantees no resource leaks, even on panic or error paths. **Never manually manage session state** — always use `SessionGuard`.

## Capture Flow (Rust → Frontend → Rust)

### 1. Hotkey Trigger

A global hotkey (registered via `global-hotkey` crate) fires `run_capture` in `lib.rs`. This:

- Captures all monitors in parallel using `xcap`
- Enumerates windows with platform-specific APIs (Core Graphics on macOS, Win32 on Windows, X11 on Linux)
- Saves frames as PNGs in the app cache directory
- Emits the `capture:start` event to each overlay window with:
  - `monitorId` — which monitor this overlay belongs to
  - `frameUrl` — `asset://` URL to the frozen PNG
  - `windows` — array of window rects translated to monitor-local coordinates
  - `scaleFactor` — for DPI-aware cropping

### 2. Overlay Interaction

Each monitor gets its own webview window (label: `overlay-{monitor_id}`). The overlay runs a **Zustand state machine**:

```
idle → hover → dragging → committed
  ↑                            │
  └────────── esc ─────────────┘
```

- **idle** — Waiting for capture:start event
- **hover** — Mouse moves over frozen frame; window detection active
- **dragging** — User is drawing a selection
- **committed** — Selection finalized; annotation + action toolbars shown

The overlay also supports **locked** (peer monitor claimed the selection) and **scrollStarting/scrolling** states.

### 3. Crop & Output

When the user copies or saves:

1. Frontend calls `cropAndCopy` or `cropAndSave` with:
   - Monitor ID (to look up the frozen frame)
   - Selection rect (in logical pixels)
   - Optional annotation PNG overlay
   - Corner radius for rounded corners
   - Image adjustments (brightness, contrast, etc.)

2. Rust retrieves the frozen frame from `WindowMgr`, crops it with scale factor awareness, applies adjustments, merges annotations, and outputs to clipboard or file.

## Key Rust Modules

| Module | Responsibility |
|--------|---------------|
| `window_mgr.rs` | Session lifecycle manager. Creates, holds, and cleans up sessions via `SessionGuard`. |
| `capture/` | Platform-specific screen capture using `xcap` (cross-platform). |
| `window_probe/` | Platform-specific window enumeration for smart window detection. |
| `hotkey.rs` | Global hotkey registration with live updates when settings change. |
| `commands.rs` | Tauri command handlers — all commands receive `State<Arc<WindowMgr>>`. |
| `tray.rs` | System tray icon with menu (capture, settings, about, quit). |
| `pin_mgr.rs` | Manages pinned screenshot windows — creates, scales, closes pins. |
| `scroll_session.rs` | Orchestrates scrolling capture sessions. |
| `scroll_stitch.rs` | Stitches captured frames into a single image using NCC-based seam detection. |
| `settings_store.rs` | Persists settings via `tauri-plugin-store`. |
| `permission.rs` | Checks and requests screen recording permission (macOS). |

## Key Frontend Modules

| Module | Responsibility |
|--------|---------------|
| `overlay/state.ts` | Zustand store — state machine for capture overlay. |
| `overlay/FrozenLayer.tsx` | Renders the frozen screenshot with SVG filters for adjustments. |
| `overlay/SelectionBox.tsx` | Selection rectangle with resize handles. |
| `overlay/Toolbar.tsx` | Action toolbar (copy, save, pin, scroll, close). |
| `overlay/ColorPicker.tsx` | Hover-based color picker with format toggling. |
| `overlay/ImageAdjustmentsPanel.tsx` | Brightness, contrast, saturation, grayscale controls. |
| `overlay/CornerRadiusPanel.tsx` | Slider for rounded screenshot corners. |
| `annotation/store.ts` | Zustand store for annotation state (objects, tools, undo/redo). |
| `annotation/Stage.tsx` | Konva-based canvas for rendering annotation objects. |
| `annotation/Toolbar.tsx` | Annotation tool selector + property panel. |
| `annotation/tools/` | 13 individual tool implementations (rect, arrow, text, blur, etc.). |
| `lib/geometry.ts` | Pure functions for rect operations (clamp, resize, hit-test). |
| `lib/hit-test.ts` | Z-order window hit-testing — returns topmost window at cursor position. |

## Multi-Monitor Handling

Each monitor gets its own webview window. The system:

1. Captures all monitors in parallel.
2. Creates one overlay window per monitor with `label: "overlay-{monitor_id}"`.
3. Emits `capture:start` with monitor-local coordinates for windows.
4. **Selection claiming** — when one overlay starts dragging, it claims the session and other overlays show a "locked" state.
5. On crop, the monitor ID is used to look up the correct frozen frame.

## Settings Persistence

Settings are stored as JSON via `tauri-plugin-store`:

1. Frontend calls `setSettings` command.
2. Rust saves to disk and emits `settings:changed` event.
3. Hotkey service listens for this event and re-registers hotkeys.
4. This enables **live hotkey updates** without restarting the app.

## Performance Targets

| Operation | Target | Current |
|-----------|--------|---------|
| Crop | < 8ms | ~748µs |
| Capture latency | < 200ms | Subjective |
| Overlay render | 60fps | CSS transforms |
