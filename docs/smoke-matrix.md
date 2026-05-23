# Smoke Test Matrix

Manual test scenarios for Flashot V0 before release.

## Platforms

- **macOS** (primary target)
- **Windows** (secondary)

## Critical Paths

### 1. Hotkey Trigger

- [ ] Press configured hotkey (default: Cmd+Shift+A on macOS, Ctrl+Shift+A on Windows)
- [ ] Overlay appears on all monitors
- [ ] Screen is frozen (captured frame displayed)
- [ ] Cursor changes to crosshair

### 2. Capture & Crop

- [ ] Click and drag to select region
- [ ] Selection rectangle renders correctly
- [ ] Handles appear on corners and edges
- [ ] Drag handles to resize selection
- [ ] Selection stays within monitor bounds
- [ ] ESC cancels capture and hides overlay

### 3. Copy to Clipboard

- [ ] Press Cmd/Ctrl+C or click "Copy" button after committing a selection
- [ ] Overlay closes
- [ ] Paste into another app (e.g., Slack, Notes)
- [ ] Image matches selected region
- [ ] Image quality is acceptable (no artifacts)

### 4. Save to File

- [ ] Click "Save As" in the toolbar
- [ ] File picker opens
- [ ] Choose location and filename
- [ ] File saves as PNG
- [ ] Open saved file to verify content

### 5. Settings

- [ ] Open settings window (tray menu → Settings)
- [ ] Change hotkey
- [ ] New hotkey triggers capture
- [ ] Old hotkey no longer works
- [ ] Settings persist after app restart

### 6. Multi-Monitor

- [ ] Trigger capture with multiple monitors connected
- [ ] Overlay appears on all monitors
- [ ] Can select region on any monitor
- [ ] Captured region is correct (not offset)

### 7. Window Detection

- [ ] Trigger capture with multiple windows open
- [ ] Hover over windows
- [ ] Window highlights appear
- [ ] Click window to auto-select its bounds
- [ ] Captured region matches window

## Platform-Specific Behaviors

### macOS

- **Permission**: Screen recording permission required (System Settings → Privacy & Security)
- **Hotkey**: Cmd+Shift+A
- **Tray**: Icon appears in menu bar
- **File picker**: Native macOS file dialog

### Windows

- **Permission**: No special permissions required
- **Hotkey**: Ctrl+Shift+A
- **Tray**: Icon appears in system tray
- **File picker**: Native Windows file dialog

## Known Issues

- **macOS**: First launch requires screen recording permission grant and app restart
- **Windows**: Overlay may flicker on some systems with multiple GPUs

## Pre-Release Checklist

- [ ] All critical paths pass on macOS
- [ ] All critical paths pass on Windows
- [ ] No crashes or panics during normal use
- [ ] No memory leaks (run for 30+ captures)
- [ ] Hotkey can be changed and persists
- [ ] Settings window opens and closes cleanly
- [ ] Tray icon and menu work correctly
- [ ] App quits cleanly (no zombie processes)
- [ ] Logs are written to expected location
- [ ] Performance: crop_bench < 8ms (see CI)
- [ ] Performance: capture feels instant (< 200ms)
- [ ] Performance: overlay renders at 60fps

## Test Environment

- **macOS**: 13.0+ (Ventura or later)
- **Windows**: 10/11

## Scrolling Screenshot (v1)

| Target | macOS | Windows | Linux X11 |
|---|---|---|---|
| Long web page (Chrome / Firefox) | ⏳ pending | ⏳ pending | ⏳ pending |
| Long PDF in system reader | ⏳ pending | ⏳ pending | ⏳ pending |
| Chat scrollback (Slack / Discord / Telegram) | ⏳ pending | ⏳ pending | ⏳ pending |

Procedure: trigger capture → draw selection over scrollable content → click Scrolling Screenshot button in Toolbar → scroll with mouse/trackpad → verify chrome window shows live preview + frame count → click Done → paste/save stitched result and visually verify no missing rows or duplicate rows. Esc cancels the scroll session and tears down the chrome window.

Known limitations:
- Wayland: passthrough behavior of `set_ignore_cursor_events` not validated; X11 only for v1.
- Selection height < 100 logical px: Scrolling Screenshot button is disabled.
- Fast scrolling may yield `scroll:match-failed` events; a toast surfaces in the chrome window after 5 consecutive failures.

## Reporting Issues

When filing bugs, include:

- Platform and version
- Steps to reproduce
- Expected vs actual behavior
- Logs from `~/Library/Caches/flashot/logs` (macOS) or equivalent
- Screenshots if applicable
