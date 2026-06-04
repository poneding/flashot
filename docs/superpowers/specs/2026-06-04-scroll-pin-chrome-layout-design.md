# Scroll Capture Chrome And Pin Toolbar Layout Design

**Status:** Draft
**Date:** 2026-06-04

## Problem

Two UI details need refinement:

- Pin window toolbars feel slightly offset from the pinned image/window edge.
- The scrolling screenshot chrome should feel lighter and more contextual while the user scrolls, then make the default finish action clear.

## Scope

In scope:

- Align Pin window toolbar anchors:
  - vertical Pin controls top edge aligns with the pinned image content edge;
  - horizontal Pin annotation toolbar left edge aligns with the same content edge.
- Move the scrolling screenshot preview panel to the selection's right side, aligned toward the lower edge.
- Add edge fallback for the preview panel, modeled after existing toolbar positioning:
  - prefer right-lower;
  - flip to left-lower when right side would overflow;
  - clamp inside monitor bounds as the final fallback.
- Show the current selected region in the scroll panel immediately after entering scroll mode.
- Keep rendering the growing stitched preview while scrolling, visually pushing the long screenshot upward as new rows are appended.
- Float `Frames · px` at the bottom center of the panel as a translucent status pill.
- Show `Scroll the window below to capture...` briefly inside the selection near the top when scrolling mode starts.
- Show a centered green frosted Check button inside the selection near the bottom only after actual scrolling has been accepted by the stitcher.
- Make the Check button finish the scroll session and pin the stitched screenshot by default.

Out of scope:

- Changing the stitcher algorithm.
- Adding automated scrolling.
- Changing scroll output formats.
- Adding new post-scroll copy/save choice UI.

## User-Facing Behavior

After the user clicks the scroll screenshot action, the app enters scroll mode. The selected region remains visually outlined and the user can scroll the underlying window.

At scroll start:

- A short translucent hint appears inside the selection near the top: `Scroll the window below to capture...`.
- The preview panel appears near the lower-right side of the selection.
- The preview panel shows the current selected region instead of a black or empty placeholder.
- The panel status reads `0 Frames · <selection height>px` or the nearest existing localized status form.

While scrolling:

- Accepted scroll progress updates the preview panel with the stitched preview.
- The preview remains bottom-aligned so new content makes the composed image appear to move upward.
- The `Frames · px` status floats over the panel at the bottom center with a translucent background.
- Once at least one real scroll append is accepted, the green Check button appears inside the selection near the bottom center.

When the user clicks Check:

- The app finishes the active scroll session.
- The stitched result is pinned immediately using the existing `scrollPin()` command.
- The check action is the primary completion path.

Cancel behavior remains available through the existing cancel path, such as Escape.

## Layout Rules

### Pin Toolbars

Use the pin content edge as the shared visual anchor.

- Vertical Pin controls: keep the existing right-side position, but set the top offset to the content edge, not content edge plus toolbar gap.
- Horizontal annotation toolbar in Pin edit mode: keep it outside the image at the lower-left area, but align its left edge to the same content edge.
- Keep existing hover/focus visibility, tooltips, scale menu, and image adjustment behavior.

### Scroll Preview Panel

The scroll preview is hosted in a separate Tauri webview window (`overlay-chrome-{monitor_id}`), so edge placement belongs in the backend window-spawn helper, not only in React styles. Update `spawn_scroll_chrome` with a positioning helper similar in spirit to `computeVerticalToolbarPosition` and `computeSidePanelPosition`.

Preferred position:

- `left = selection.x + selection.width + gap`
- `top = selection.y + selection.height - panel.height`

Fallbacks:

- If the preferred right-side position would overflow the monitor, flip to the left side:
  - `left = selection.x - panel.width - gap`
  - keep lower alignment where possible.
- Clamp `top` to monitor bounds.
- If neither side fits cleanly, clamp the panel inside the monitor while preserving lower alignment as much as possible.

The panel must never extend outside the monitor and must avoid covering the Check button when there is room on either side.

## Component And Data Flow

Frontend changes:

- `Pin.tsx`
  - Adjust the offsets used by Pin controls and Pin edit toolbar selection.
  - Update tests that assert toolbar positions.
- `Overlay.tsx`
  - Replace the current `ScrollStartupStatus` with a scroll-mode overlay that can render:
    - the top hint during early scroll mode;
    - the bottom Check button only after scroll progress shows actual appended frames.
  - Subscribe to `scroll:progress` while in scrolling mode, or consume a shared progress state, so the overlay can distinguish "entered scroll mode" from "actual appended scroll frame accepted".
  - The Check button calls `scrollPin()`.
- `ScrollChrome.tsx`
  - Rework the panel UI:
    - remove the full bottom action bar;
    - show the preview content immediately;
    - show the floating status pill;
    - use transparent/frosted styling.
  - The panel uses progress preview when available.

The current backend already initializes `ScrollStitcher` with the initial selected frame, but the frontend does not receive a preview until a later accepted append. To meet the default-thumbnail requirement, emit an initial `scroll:progress`-compatible payload after the stitcher is created and before the user scrolls. This initial payload should carry the selected-region preview, `frames = 0`, the initial selection height, and a neutral score. Do not change the stitcher algorithm for this UI work.

Backend changes:

- `commands.rs`
  - Update `spawn_scroll_chrome` to position the chrome window at the selection's right-lower side by default.
  - Flip the chrome window to the selection's left-lower side when the right side would overflow the monitor.
  - Clamp the window inside the monitor as the final fallback.
  - Keep all calculations in logical pixels before calling `.position(x, y)`.
- `scroll_session.rs`
  - Emit an initial `scroll:progress`-compatible payload after the stitcher is created and before the user scrolls.
  - Keep accepted scroll detection distinct from the initial payload. The Check button appears only after `frames > 0`.

## Error Handling

- If `scrollPin()` fails after Check, leave scroll mode visible and log the failure.
- If preview data is unavailable, show a lightweight translucent placeholder, never a solid black panel. Normal operation should use the initial progress payload so this fallback is rare.
- If the panel cannot fit beside the selection, clamp within the monitor bounds.
- If no actual scroll append has occurred, keep the Check button hidden to avoid finishing an accidental zero-scroll capture.

## Testing

Frontend tests:

- Pin route test for vertical controls top offset aligned to the content edge.
- Pin route or annotation toolbar test for horizontal Pin edit toolbar left alignment.
- Geometry tests for scroll panel right-lower placement, left flip, and final clamp.
- Scroll chrome test for floating status pill and removal of the old full-width action bar.
- Overlay route test that:
  - shows the top hint during scroll mode;
  - hides Check before accepted scroll progress;
  - shows Check after progress with appended frames;
  - calls `scrollPin()` when Check is clicked.

Rust tests should cover the initial progress payload when backend progress emission is changed.
