# Quick Shot Design

## Overview

Add two no-overlay screenshot actions to Flashot:

- capture the active display and copy it to the clipboard
- capture the active foreground window and copy it to the clipboard

Keep the existing region capture flow unchanged. Settings should expose all
three shortcuts with platform-native labels, so users see `Cmd+Shift+...` on
macOS and `Ctrl+Shift+...` elsewhere, never `CommandOrControl`.

## Scope

- Three configurable global shortcuts:
  - region capture
  - active-display quick shot
  - active-window quick shot
- Backward-compatible settings migration from the old single `hotkey` field
- Backend hotkey routing for multiple screenshot actions
- Rust command paths that copy an active-display or active-window crop directly
  to the clipboard
- Settings UI for editing and resetting all three shortcuts
- README/test updates for the new shortcut model

## Non-Goals

- Saving quick shots directly to files
- Showing overlay UI for quick shots
- Capturing all displays into one stitched image
- Adding annotation before quick-shot copy
- Wayland-native active-window detection beyond the existing Linux/X11 support

## Design

### Settings Model

Extend `Settings` with three shortcut fields:

- `captureHotkey`: existing overlay/region capture
- `fullscreenHotkey`: active-display quick shot
- `activeWindowHotkey`: foreground-window quick shot

The old `hotkey` field remains accepted during deserialization and migrates to
`captureHotkey`. New serialized settings use camelCase field names and omit the
legacy field.

Default storage values should use platform-specific modifiers:

- macOS: `Cmd+Shift+A`, `Cmd+Shift+F`, `Cmd+Shift+W`
- non-macOS: `Ctrl+Shift+A`, `Ctrl+Shift+F`, `Ctrl+Shift+W`

### Hotkey Routing

Replace the single current hotkey id with a small action map. Register the three
configured accelerators with the same `global-hotkey` manager and map each id to
one of:

- `TriggerCapture`
- `CopyActiveDisplay`
- `CopyActiveWindow`
- `CancelCapture`

Escape still cancels only while an overlay capture session is active. Quick-shot
hotkeys should be ignored during an overlay capture session so they do not race
with the session guard or frozen frames.

When settings change, re-register all screenshot hotkeys and update the tray menu
with the region capture shortcut.

### Active Display Quick Shot

The active display is the display containing the foreground window at hotkey
time. If the foreground window spans displays, use the display with the largest
intersection area. If no foreground window can be detected, fall back to the
display containing the cursor; if that is unavailable, use the first monitor
returned by `xcap`.

Implementation path:

1. Capture all monitors via existing `capture::capture_all_monitors()`.
2. Resolve the active display from monitor geometry and active-window/cursor
   context.
3. Copy that monitor's full frozen frame to the clipboard.

This avoids overlay creation and avoids stitching multiple displays.

### Active Window Quick Shot

Add a platform-specific `window_probe::active_window()` function returning the
foreground window as a `WindowRect`.

- macOS: get the frontmost application through AppKit and match its PID against
  the Core Graphics window list, choosing the first normal layer-0 window for
  that PID.
- Windows: call `GetForegroundWindow()`, reuse the existing window filtering and
  visible-frame helpers, then return one `WindowRect`.
- Linux/X11: read `_NET_ACTIVE_WINDOW`, expand frame extents as in existing
  enumeration, and map it to `WindowRect`. If unavailable, return an error so
  the command can fail gracefully.

The copy command captures all monitors, finds the monitor(s) intersecting the
active window, and crops the window bounds. For the first implementation, if a
window spans displays, use the monitor with the largest intersection and copy
the clipped visible portion on that monitor. This matches the active-display
rule and keeps behavior predictable without introducing multi-monitor image
composition.

### Frontend Settings

Settings should show three rows:

- Region capture
- Active screen quick shot
- Active window quick shot

`HotkeyRecorder` should display normalized platform labels. If a value contains
`CommandOrControl`, the UI should render it as `Cmd` on macOS and `Ctrl`
elsewhere. Recorded values should already use platform-specific labels.

Reset should restore all defaults for the current platform.

### Error Handling

- If quick-shot capture fails, log the error and do not show the overlay.
- If active-window detection fails, log the error and leave the clipboard
  unchanged.
- Settings save should fail normally if any shortcut cannot be parsed or
  registered on the next settings change; the app keeps running and logs the
  registration failure, consistent with existing startup behavior.

## Testing

- Rust unit tests for settings defaults, legacy migration, and serialization
- Rust unit tests for multi-hotkey action routing
- Rust unit tests for monitor/window geometry selection and crop behavior
- Frontend tests for three settings shortcut rows and platformized display text
- Existing crop and overlay tests should continue to pass
