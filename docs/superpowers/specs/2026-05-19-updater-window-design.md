# Check for Updates Window Design

## Overview

A standalone window for checking and installing app updates. Uses a centered minimal UI style that will serve as the reference for future window redesigns.

## Window Configuration

| Property | Value |
|----------|-------|
| Label | `updater` |
| Route | `#/updater` |
| Title | `Check for Updates` |
| Size | 360 × 280 |
| Resizable | No |
| Singleton | Yes (focus existing if open) |

## Trigger

Tray menu "Check for updates" → opens/focuses the updater window. The window automatically begins checking on mount.

## State Machine

```
mount → checking → up-to-date
                 → available → downloading → restart
                 → error
```

## UI States

All states use a vertically centered layout with a prominent icon, title text, optional subtitle, and action buttons at the bottom.

### checking

- Spinner animation (CSS, no extra dependency)
- Text: "Checking for updates…"

### up-to-date

- Icon: `CircleCheck` (lucide-react), green
- Title: "You're up to date"
- Subtitle: current version, e.g. "Version 0.2.1"
- Button: "Close"

### available

- Icon: `ArrowUpCircle` (lucide-react), blue
- Title: "A new version is available"
- Subtitle: new version number, e.g. "v0.3.0"
- Optional: release notes in a scrollable area (max-height 100px), shown only when `body` is non-empty
- Buttons: "Later" (secondary) | "Download & Install" (primary)

### downloading

- Icon: `ArrowDownCircle` (lucide-react), blue
- Title: "Downloading…"
- Progress bar: shows percentage when total is known, indeterminate animation otherwise
- No action buttons (non-cancellable)

### restart

- Icon: `CircleCheck` (lucide-react), green
- Title: "Ready to restart"
- Subtitle: "Restart to finish updating"
- Button: "Restart Now" (primary)

### error

- Icon: `XCircle` (lucide-react), red
- Title: "Update check failed"
- Subtitle: brief error message
- Buttons: "Retry" (secondary) | "Close" (secondary)

## Technical Implementation

### Frontend

- New file: `src/routes/Updater.tsx`
- State management: `useState` with type `"checking" | "up-to-date" | "available" | "downloading" | "restart" | "error"`
- On mount (`useEffect`): call `checkForUpdate()` from `src/lib/updater.ts`
- Progress bar: plain `<div>` with CSS `width` transition
- Icons: lucide-react (already a project dependency)
- Window close: `getCurrentWindow().close()` from `@tauri-apps/api/window`
- Restart: `relaunch()` from `@tauri-apps/plugin-process`

### App.tsx routing

Add route detection:
```typescript
if (h.startsWith("#/updater")) return "updater";
```

Render `<UpdaterRoute />` for the updater route.

### Rust backend

- Add `open_updater_window` in `src-tauri/src/commands.rs`, following the same pattern as `open_about_window`:
  - Check if window with label `updater` exists → show + focus
  - Otherwise create with URL `index.html#/updater`, size 360×280, non-resizable
- Register the new command in `tauri::generate_handler![]`
- Tray menu handler for `"updates"`: call `crate::commands::open_updater_window(app.clone())` directly instead of emitting `updater:check` event
- Remove the `updater:check` event (no longer needed)

### IPC

No new IPC commands needed. The frontend uses `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process` directly (already wired up in `src/lib/updater.ts`).

## Out of Scope

- Automatic background update checks
- Update notification badge on tray icon
- "Skip this version" functionality
- i18n (English only for now)

## Visual Style Notes

- Centered minimal layout: all content vertically and horizontally centered
- Large icon (32-40px) as the visual anchor
- Title in semibold, subtitle in muted foreground color
- Generous vertical spacing between icon, text, and buttons
- This style will be the reference when redesigning Settings and About windows later
