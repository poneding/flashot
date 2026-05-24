# Measurement Annotation Tool

**Status:** Approved design, pending written spec review
**Date:** 2026-05-24

## Problem

Users want to mark pixel distances directly on a captured screenshot. The
feature should let them drag a line over the committed screenshot selection and
export the line with a readable `px` label when copying, saving, or pinning.

## Scope

- In scope:
  - Region capture annotations after the screenshot selection is committed.
  - A new measurement annotation tool for two-point straight-line distances.
  - Measurement values shown in logical pixels.
  - Copy, save, and pin output through the existing annotation export pipeline.
- Out of scope for the first pass:
  - Physical pixel measurements on high-DPI displays.
  - Area measurements, rectangle width/height callouts, angle measurements, or
    multi-segment paths.
  - Unit switching, snapping, and Shift-based horizontal/vertical locking.
  - A settings panel preference for measurement behavior.

## User-Facing Design

A new Measure button appears in the existing annotation toolbar next to the
line and arrow tools. The button uses a ruler-style icon and the tooltip
`Measure`.

When the tool is active, the user drags inside the committed selection. During
the drag, Flashot previews a straight measurement line, endpoint ticks, and a
label such as `128 px`. Releasing the mouse commits the object. Tiny drags
under the existing line threshold are discarded.

The committed measurement behaves like other annotations: it can be selected,
deleted, undone, redone, exported, and edited. Endpoint editing should follow
the line tool's current model with start and end handles. The first version
does not include a curved control point because measurement is defined as a
straight two-point distance.

The measurement value is always computed in logical pixels:

```ts
Math.round(Math.hypot(end.x - start.x, end.y - start.y))
```

This matches the coordinate system users already see while selecting and
annotating regions. On Retina or other high-DPI displays, the exported PNG is
still rendered at `scaleFactor`, but the visible label remains the logical
pixel value.

## Architecture

The feature lives entirely in the frontend annotation layer. No new Rust
commands or crop/composite behavior are needed.

Current output flow remains unchanged:

```txt
AnnotationStage
  -> exportAnnotationLayer(scaleFactor)
  -> cropAndCopy / cropAndSave / pinImage(annotationPng)
  -> Rust composites annotation PNG over cropped frozen frame
```

The new tool should follow the existing annotation architecture:

- `src/annotation/types.ts`
  - Add `measure` to `ToolType`.
  - Add `measure` to `AnnotationObject["type"]`.
- `src/annotation/store.ts`
  - Use the existing command stack and style persistence.
  - Measurement can share the active color and stroke width style fields.
- `src/annotation/Toolbar.tsx`
  - Add the Measure toolbar button.
- `src/annotation/PropertyPanel.tsx`
  - Add a compact measurement section with color and stroke width controls.
  - Label typography and badge styling remain fixed for the first pass.
- `src/annotation/Stage.tsx`
  - Register measure start/move/end handlers.
  - Treat `measure` as an endpoint-editable line-like object.
  - Do not use the Konva Transformer for measurement objects.
- `src/annotation/tools/measure.ts`
  - Own preview drawing, object creation, rendering, length calculation, label
    placement, and endpoint updates.
- `src/annotation/render.ts`
  - Dispatch `measure` objects to the measure renderer.

## Data Model

Measurement objects use the same core shape as line objects:

```ts
type AnnotationObject = {
  id: AnnotationId;
  type: "measure";
  start: Point;
  end: Point;
  style: AnnotationStyle;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  };
};
```

The stored object does not persist the rendered label text. The label is derived
from `start` and `end` every time the object renders, which keeps undo/redo and
endpoint editing consistent.

Measurement should not use `points` in the first pass. Reserving `points` for
line curves keeps the measurement model simple and avoids accidental curved
distance semantics.

## Rendering Details

Render measurement as a `Konva.Group` positioned at the start point plus the
stored transform, matching the line tool's local-coordinate pattern.

Children:

- Main line from `(0, 0)` to `(dx, dy)`.
- Short perpendicular endpoint ticks at both ends.
- Text label centered near the midpoint, offset along the perpendicular vector.
- A rounded dark label background for contrast.

Line and ticks use `style.color` and `style.strokeWidth`. The label text is
white on a dark translucent background so it remains readable over arbitrary
screenshots. Label font size is fixed in v1, with enough padding to prevent the
text from touching the background edge.

Placement:

- Compute midpoint from the local line vector.
- Offset the label by a small perpendicular distance, at least enough to clear
  the stroke and endpoint ticks.
- For very short or nearly vertical lines, keep the same perpendicular logic;
  the label may sit close to the line but should not overlap the endpoints.

Export behavior:

- Measurement labels are normal annotation content and must be exported.
- Endpoint edit handles and selection guides are editor UI and must be hidden by
  the existing export hiding mechanism before `stage.toBlob`.

## Interaction Details

Creation:

1. User selects Measure.
2. Mouse down inside the annotation stage records `start`.
3. Mouse move updates the preview object and live label.
4. Mouse up creates a `measure` object if the drag is large enough.

Selection and editing:

- Clicking a measurement object selects it.
- Selected measurements show start and end handles.
- Dragging either handle updates `start` or `end` through the existing
  `resizeObject` command path.
- Moving the whole object is not part of the first pass unless it falls out
  naturally from existing line-like object behavior. Endpoint editing is the
  required edit path.

Keyboard:

- Existing annotation shortcuts apply:
  - Delete / Backspace deletes the selected measurement.
  - Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo.
  - Cmd/Ctrl+C and Cmd/Ctrl+S export with the measurement included.

## Error Handling

The measurement tool should fail softly:

- If no Konva layer exists, start/move/end handlers no-op like existing tools.
- If a drag is too small, destroy the preview and return `null`.
- If label measurement is unavailable in tests or browser edge cases, render
  with a conservative fallback width so the badge still appears.

No backend error path is added because the final annotation export remains a
standard transparent PNG.

## Testing

Add focused frontend tests:

- Tool creation:
  - Dragging from `(0, 0)` to `(3, 4)` produces `5 px`.
  - Tiny drags return `null` and destroy the preview.
- Rendering:
  - `renderMeasureObject` creates a group with a main line, two endpoint ticks,
    label background, and label text.
  - The label is derived from current `start` and `end`, not stored text.
- Store and toolbar:
  - `measure` can be selected as an active tool.
  - Style changes for measure use existing color and stroke width persistence.
- Stage integration:
  - `measure` is treated as line-like for endpoint editing and does not receive
    a Konva Transformer.
- Export:
  - Measurement content remains visible during export.
  - Measurement edit handles are hidden during export.

Run:

```bash
pnpm test -- src/__tests__/annotation-measure-tool.test.ts src/__tests__/annotation-render.test.ts src/__tests__/annotation-store.test.ts
pnpm lint
```

## Risks

- Label placement can collide with nearby annotations or the selection edge.
  The first pass accepts this as an annotation-level concern rather than adding
  automatic layout. A later pass can add draggable labels if needed.
- The word `px` can be ambiguous on high-DPI displays. The first pass makes the
  choice explicit: Flashot measures logical pixels only.
- Sharing style memory with line/arrow tools could accidentally mix measurement
  settings with decorative line settings. Measurement should remember only
  color and stroke width, and should ignore line shape, dash style, and arrows.

## Future Extensions

- Shift-drag axis locking.
- Physical pixel display or dual label such as `128 px @2x = 256 px`.
- Draggable label offset.
- Rectangle dimension callouts like `320 x 180 px`.
- Snapping to selection edges, object bounds, or detected window rects.
