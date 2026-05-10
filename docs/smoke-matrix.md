# Smoke Test Matrix

Manual test scenarios for Flashot V0 before release.

## Platforms

- **macOS** (primary target)
- **Windows** (secondary)
- **Linux** (secondary)

## Critical Paths

### 1. Hotkey Trigger
- [ ] Press configured hotkey (default: Cmd+Shift+5 on macOS)
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
- [ ] Press Enter or click "Copy" button
- [ ] Overlay closes
- [ ] Paste into another app (e.g., Slack, Notes)
- [ ] Image matches selected region
- [ ] Image quality is acceptable (no artifacts)

### 4. Save to File
- [ ] Press Cmd+S or click "Save" button
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
- **Hotkey**: Cmd+Shift+5 conflicts with native screenshot tool (user must choose)
- **Tray**: Icon appears in menu bar
- **File picker**: Native macOS file dialog

### Windows
- **Permission**: No special permissions required
- **Hotkey**: Win+Shift+S conflicts with Snipping Tool (user must choose)
- **Tray**: Icon appears in system tray
- **File picker**: Native Windows file dialog

### Linux
- **Permission**: Varies by compositor (Wayland may require portal)
- **Hotkey**: Varies by desktop environment
- **Tray**: May not work on all DEs (fallback to window)
- **File picker**: Native GTK file dialog

## Known Issues

- **macOS**: First launch requires screen recording permission grant and app restart
- **Windows**: Overlay may flicker on some systems with multiple GPUs
- **Linux**: Wayland support is experimental (X11 recommended)

## Pre-Release Checklist

- [ ] All critical paths pass on macOS
- [ ] All critical paths pass on Windows
- [ ] All critical paths pass on Linux (X11)
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
- **Linux**: Ubuntu 22.04 LTS (X11)

## Reporting Issues

When filing bugs, include:
- Platform and version
- Steps to reproduce
- Expected vs actual behavior
- Logs from `~/Library/Caches/flashot/logs` (macOS) or equivalent
- Screenshots if applicable
