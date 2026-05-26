# Pin Window Controls And Annotation Editing Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 5

## Problem

Pinned screenshot windows currently support dragging, wheel-based scaling, double-click close, and Escape close. These interactions are discoverable only by trial. Users need visible controls and a way to edit annotations after a screenshot has already been pinned.

## Scope

In scope:

- Hover/focus vertical toolbar on pin windows, styled like the existing screenshot vertical toolbar.
- Buttons with tooltips: Edit, fine-grained scale percentage dropdown, Close, Save, and Copy.
- Keep existing wheel zoom, drag, double-click close, and Escape close.
- Edit annotations inside the original Pin window.
- Reuse the complete existing screenshot annotation toolset and horizontal annotation toolbar while editing.
- Save edits back to the same pin id, overwriting the current pin.
- Copy the current pin composition to the clipboard.

Out of scope:

- Full image history/versioning for pins.
- Reopening the original desktop capture session after it has ended.
- OCR or scrolling-capture specific editing in the first pass.

## User-Facing Behavior

When the pointer enters a pin window, a compact vertical toolbar appears near the window edge. Buttons use the same visual language as the screenshot vertical toolbar and every button has a tooltip. The toolbar contains:

- Edit
- Scale percentage dropdown
- Close
- Save
- Copy

Clicking Edit turns the original Pin window into edit mode. The pinned image remains in place and the full existing screenshot annotation tools appear as a horizontal toolbar. Save overwrites the original pin image/annotation state. Copy copies the current pin composition. Canceling or leaving edit mode without saving leaves the pin unchanged.

Scale behavior:

- Keep the existing scale range: `50%` to `300%`.
- Use one shared scale model for dropdown and mouse wheel.
- Dropdown options are `5%` increments: `50%`, `55%`, `60%`, ..., `300%`.
- Mouse wheel zoom uses the same `5%` step instead of the current faster `10%` jump, so one normalized wheel notch maps to exactly one dropdown level.
- Wheel deltas should be normalized across `deltaMode` values and accumulated to a notch threshold. Small high-resolution trackpad deltas should not trigger immediate repeated changes, and a single wheel event should apply at most one `5%` step.
- When wheel direction changes, discard the previous accumulated remainder so zooming feels controllable instead of overshooting.
- Clamp every scale update to `50%..300%` before calling `set_pin_scale`.

## Architecture

Extend `PinManager` so each pin can track:

- base image path;
- optional annotation image path;
- current scale;
- original dimensions.

Frontend scale helpers should define the constants once, for example:

```ts
const PIN_SCALE_MIN = 0.5;
const PIN_SCALE_MAX = 3;
const PIN_SCALE_STEP = 0.05;
```

The dropdown and wheel handler both consume these constants.

Add or extend IPC commands:

- `update_pin_annotation(pin_id, annotation_png?)`
- `copy_pin(pin_id, annotation_png?)`
- existing `set_pin_scale(pin_id, scale)` should support the scale dropdown.

The Pin route should host an in-place annotation editor state. It can reuse the existing annotation stage and horizontal toolbar, but without monitor hit-testing, capture-session events, or overlay selection state. The editable stage is sized to the pinned image content. Output only the annotation layer when saving, then refresh the existing pin image stack.

## Error Handling

- If a pin id is missing, the edit command returns a typed error.
- If annotation save fails, keep the old pin visible.
- If edit mode is canceled without saving, do not mutate pin state.

## Testing

- Pin route tests for visible controls and button behavior.
- Pin route tests for `5%` scale options and slower wheel zoom.
- Rust tests for `PinManager` update behavior.
- IPC tests for new pin commands.
- In-place edit mode tests for save/cancel flow.
