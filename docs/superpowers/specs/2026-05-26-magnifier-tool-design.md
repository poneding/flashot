# Magnifier Tool Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 4

## Problem

Users need a magnifier annotation that enlarges part of the screenshot without taking another capture. The lens should look glass-like, support circle and rounded-rectangle shapes, and magnify the screenshot plus annotations that already exist beneath the lens.

## Scope

In scope:

- New annotation tool: `magnifier`.
- Lens shapes: circle and rounded rectangle.
- Configurable zoom level from 110% to 200%, defaulting to 150%.
- Configurable lens size, border color, border width, and corner radius.
- Live preview using a composited source that includes the frozen screenshot and existing annotations under the lens.
- Copy/save/pin export through the existing annotation PNG path.

Out of scope:

- Real-time magnifying of content outside the original captured selection.
- Distortion shaders or 3D glass physics.
- Animated lens effects.

## User-Facing Behavior

Select the Magnifier tool, then drag on the selected screenshot to place a lens. The lens displays a zoomed crop centered under the lens. Users can move and resize the lens like other annotations. The property panel controls zoom, shape, border, and corner radius. Copy/save/pin output must match the live preview exactly.

## Data Model

Add:

```ts
type ToolType = ... | "magnifier";

type AnnotationObject = {
  type: ... | "magnifier";
  start?: Point;
  end?: Point;
  style: AnnotationStyle;
};

type AnnotationStyle = {
  magnifierShape?: "circle" | "rounded-rect";
  magnifierZoom?: number; // 1.1..2.0, default 1.5
  magnifierBorderColor?: string;
  magnifierBorderWidth?: number;
  magnifierCornerRadius?: number;
};
```

## Architecture

`AnnotationStage` needs access to a composited source image for magnification. That source is generated from the adjusted frozen screenshot plus annotation objects that are visually beneath the magnifier, excluding the magnifier itself to avoid recursive rendering. The magnifier renderer creates a `Konva.Group`:

- clipped lens container;
- `Konva.Image` showing the composited source with crop/scale based on lens bounds and zoom;
- subtle translucent overlay/border for glass-like appearance.

Because the renderer draws the same composited source into the annotation canvas for preview and export, the existing annotation export path includes magnifiers without backend changes and can match the preview.

## Error Handling

- If the source image is not loaded, render a border-only placeholder and retry when loaded.
- Clamp zoom to `1.1..2.0`.
- Keep the lens inside the annotation stage during creation; movement can use existing transform behavior.

## Testing

- Renderer test for circle and rounded-rectangle lens.
- Stage test verifying `frameUrl` is passed to annotation rendering.
- Export/preview parity test for magnifier object inclusion.
- Toolbar/property-panel tests.
