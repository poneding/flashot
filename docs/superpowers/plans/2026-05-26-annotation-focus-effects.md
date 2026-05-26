# Annotation Focus Effects Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spotlight/focus mode to rectangle and ellipse annotations.

**Architecture:** Store focus settings on `AnnotationStyle`, render focus masks in the existing Konva annotation layer, and keep copy/save/pin export unchanged because annotation export already captures the layer.

**Tech Stack:** React, TypeScript, Zustand, Konva, Vitest, React Testing Library.

---

## File Structure

- Modify: `src/annotation/types.ts` - focus style fields and defaults.
- Modify: `src/annotation/PropertyPanel.tsx` - focus toggle and opacity control for rect/ellipse.
- Create: `src/annotation/focus.ts` - Konva helpers for stage-local focus masks.
- Modify: `src/annotation/render.ts` - pass stage size into rect/ellipse rendering.
- Modify: `src/annotation/Stage.tsx` - call renderer with current selection dimensions.
- Modify: `src/annotation/tools/rect.ts` - use focus-aware rendering for finalized rect objects.
- Modify: `src/annotation/tools/ellipse.ts` - use focus-aware rendering for finalized ellipse objects.
- Test: `src/__tests__/annotation-render.test.ts`
- Test: `src/__tests__/annotation-property-panel.test.tsx`
- Test: `src/__tests__/annotation-stage-selection.test.tsx`

## Chunk 1: Style Model And Controls

### Task 1: Add focus style fields

- [ ] **Step 1: Write failing tests**

Add tests that assert `DEFAULT_STYLE.focusMode === "none"`, opacity defaults to `0.45`, and invalid opacity values are clamped when set through the store.

Run: `pnpm test src/__tests__/annotation-store.test.ts`

Expected: FAIL because the fields do not exist.

- [ ] **Step 2: Update `AnnotationStyle`**

Add:

```ts
focusMode?: "none" | "spotlight";
focusOpacity?: number;
focusColor?: string;
```

Update `DEFAULT_STYLE` with `focusMode: "none"`, `focusOpacity: 0.45`, and `focusColor: "#000000"`.

- [ ] **Step 3: Clamp style updates**

In `src/annotation/store.ts`, normalize `focusOpacity` to `0..1` inside the existing active-style normalization path.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/annotation-store.test.ts`

Expected: PASS.

### Task 2: Add property-panel controls

- [ ] **Step 1: Write failing panel tests**

In `annotation-property-panel.test.tsx`, assert rectangle and ellipse panels show a `Focus` toggle and opacity control, while line/text/highlight panels do not.

- [ ] **Step 2: Implement controls**

In `PropertyPanel.tsx`, show focus controls only for `rect` and `ellipse`. Use compact controls consistent with existing stroke/corner controls.

- [ ] **Step 3: Verify**

Run: `pnpm test src/__tests__/annotation-property-panel.test.tsx`

Expected: PASS.

## Chunk 2: Focus Rendering

### Task 3: Create focus renderer helper

- [ ] **Step 1: Write failing render tests**

Add tests for a focused rect and focused ellipse. Assert the rendered object is a `Konva.Group`, contains a dim mask node, and preserves the target object id.

- [ ] **Step 2: Implement `src/annotation/focus.ts`**

Export helpers:

```ts
export type StageSize = { width: number; height: number };
export function shouldRenderFocus(style: AnnotationStyle): boolean;
export function createRectFocusMask(...): Konva.Group;
export function createEllipseFocusMask(...): Konva.Group;
```

Use a custom `Konva.Shape` scene function to paint the area outside the focus hole.

- [ ] **Step 3: Wire renderers**

Update rect/ellipse render paths so normal objects still return their existing Konva shapes, while focused objects return a focus group.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/annotation-render.test.ts`

Expected: PASS.

## Chunk 3: Stage Integration

### Task 4: Pass stage size into rendering

- [ ] **Step 1: Write failing stage test**

Assert `Stage` re-renders a focused object when selection dimensions change.

- [ ] **Step 2: Update `Stage.tsx` and `render.ts`**

Pass `{ width: selection.width, height: selection.height }` into `renderObject`.

- [ ] **Step 3: Run focused tests**

Run: `pnpm test src/__tests__/annotation-stage-selection.test.tsx src/__tests__/annotation-render.test.ts`

Expected: PASS.

- [ ] **Step 4: Run full frontend tests**

Run: `pnpm test`

Expected: PASS.
