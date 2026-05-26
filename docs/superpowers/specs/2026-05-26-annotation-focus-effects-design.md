# Annotation Focus Effects Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 1

## Problem

Rectangle and ellipse annotations currently draw only a border or fill. Users want a focus effect: the region inside the shape stays normal, while the area outside the shape is dimmed. This is useful when the screenshot should guide attention without cropping away context. The focus effect is a persistent annotation style, not a temporary overlay-only state.

## Scope

In scope:

- Add focus mode to rectangle and ellipse annotation objects.
- Render the focus mask in the annotation layer so copy, save, and pin outputs include it.
- Provide a property-panel toggle and opacity control.
- Preserve existing rect/ellipse fill, stroke, corner radius, transform, undo/redo, and export behavior.

Out of scope:

- Focus mode for freehand pen, arrow, line, blur, text, measure, marker, or magnifier.
- Multiple independent mask blending modes beyond a single dim color and opacity.
- Backend-side mask generation.

## User-Facing Behavior

Rectangle and ellipse property panels gain a focus toggle. When enabled:

- The inside of the shape is transparent and unchanged.
- The area outside the shape is covered with a semi-transparent shadow.
- The existing shape stroke remains visible as the boundary.
- Opacity defaults to `0.45` and can be adjusted with a compact control.

If the object is moved, resized, or rotated, the focus hole follows the object. The mask is clipped to the annotation stage, which is the selected screenshot region.

## Data Model

Extend `AnnotationStyle`:

```ts
focusMode?: "none" | "spotlight";
focusOpacity?: number;
focusColor?: string;
```

Defaults:

- `focusMode: "none"`
- `focusOpacity: 0.45`
- `focusColor: "#000000"`

The object type remains `rect` or `ellipse`. This avoids a separate annotation type and keeps existing selection, movement, and export paths intact.

## Architecture

Create a focused renderer helper in `src/annotation/focus.ts`:

- Input: annotation object, stage size, and shape kind.
- Output: a `Konva.Group` containing:
  - a custom `Konva.Shape` that paints the dim area outside the rect/ellipse hole;
  - the normal shape stroke/fill renderer on top.

The custom shape uses the current annotation stage dimensions instead of monitor dimensions. This makes export deterministic because the annotation PNG is already selection-local.

`renderObject` should receive stage dimensions from `Stage.tsx` so focus masks know the bounds. Tests should cover that non-focused objects render exactly as before.

## Error Handling

- Clamp `focusOpacity` to `0..1`.
- If stage dimensions are missing, render the normal object without a focus mask.
- If a rect/ellipse is smaller than 4 px, keep the existing behavior and discard it.

## Testing

- Unit test style defaults and normalization.
- Render tests for rect and ellipse focus objects.
- Stage tests verifying the renderer receives selection dimensions.
- Export regression test ensuring focused objects appear in the annotation PNG path.
