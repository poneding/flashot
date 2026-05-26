# Magnifier Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a magnifier annotation that renders a zoomed view of the captured screenshot plus existing annotations.

**Architecture:** Build a composited magnifier source from the frozen screenshot plus annotation objects beneath the lens, add a `magnifier` object type, and render each magnifier as a clipped Konva image group. Use the same renderer for preview and export so output matches what the user sees.

**Tech Stack:** React, TypeScript, Zustand, Konva, Canvas image loading, Vitest, React Testing Library.

---

## File Structure

- Modify: `src/routes/Overlay.tsx` - pass `frameUrl` to annotation stage.
- Modify: `src/annotation/Stage.tsx` - load source image, build composited magnifier source, and pass render context.
- Modify: `src/annotation/types.ts`
- Create: `src/annotation/tools/magnifier.ts`
- Modify: `src/annotation/render.ts`
- Modify: `src/annotation/Toolbar.tsx`
- Modify: `src/annotation/PropertyPanel.tsx`
- Test: `src/__tests__/annotation-render.test.ts`
- Test: `src/__tests__/annotation-toolbar.test.tsx`
- Test: `src/__tests__/annotation-property-panel.test.tsx`
- Test: `src/__tests__/overlay-route.test.tsx`

## Chunk 1: Stage Image And Composition Context

### Task 1: Pass frozen image and annotation composition into annotation stage

- [ ] **Step 1: Write failing route/stage tests**

Assert `OverlayRoute` passes the active `frameUrl` into `AnnotationStage`, and `Stage` creates a magnifier render context once the image loads. Add a test that the render context can include existing annotation objects while excluding the magnifier currently being rendered.

- [ ] **Step 2: Update props**

Add `frameUrl` to the annotation stage props and load it with `HTMLImageElement`. Add a small composition helper that can render base image plus prior annotation objects into an offscreen canvas or equivalent Konva image source.

- [ ] **Step 3: Handle load states**

Keep normal annotation tools working while the image is loading. If the composited source is unavailable, magnifiers render a border-only placeholder until the source is ready.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/overlay-route.test.tsx`

Expected: PASS.

## Chunk 2: Magnifier Object And Renderer

### Task 2: Implement magnifier rendering

- [ ] **Step 1: Write failing render tests**

Assert circle and rounded-rectangle magnifiers render as `Konva.Group` with a clipped composited image and border.

- [ ] **Step 2: Extend types and defaults**

Add `magnifier` tool/object fields and defaults: shape `circle`, zoom `1.5`, zoom clamp `1.1..2.0`, border width `2`, corner radius `12`.

- [ ] **Step 3: Create `tools/magnifier.ts`**

Implement drag-to-create behavior using `start` and `end` points.

- [ ] **Step 4: Wire `render.ts`**

Pass render context containing the composited source image and stage size into the magnifier renderer.

- [ ] **Step 5: Verify**

Run: `pnpm test src/__tests__/annotation-render.test.ts`

Expected: PASS.

## Chunk 3: UI Controls

### Task 3: Add toolbar and property controls

- [ ] **Step 1: Write failing UI tests**

Assert toolbar has `Magnifier`; property panel has shape, zoom options/sliders from 110% to 200%, border width, color, and radius controls.

- [ ] **Step 2: Implement toolbar button**

Use a `Search` or `ZoomIn` Lucide icon.

- [ ] **Step 3: Implement panel controls**

Use segmented controls for lens shape and compact numeric controls/sliders for zoom and size-related fields. Default zoom must show 150%.

- [ ] **Step 4: Verify full frontend tests**

Run: `pnpm test`

Expected: PASS.
