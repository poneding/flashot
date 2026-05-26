# Number Marker Tool Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a numbered marker annotation tool with optional editable bubble text.

**Architecture:** Add a new `marker` tool and object type to the existing annotation system. Store a session-local current marker number, render markers as Konva groups, and edit marker text with a small DOM overlay anchored to the selected marker.

**Tech Stack:** React, TypeScript, Zustand, Konva, Vitest, React Testing Library.

---

## File Structure

- Modify: `src/annotation/types.ts`
- Modify: `src/annotation/store.ts`
- Create: `src/annotation/tools/marker.ts`
- Modify: `src/annotation/render.ts`
- Modify: `src/annotation/Stage.tsx`
- Modify: `src/annotation/Toolbar.tsx`
- Modify: `src/annotation/PropertyPanel.tsx`
- Test: `src/__tests__/annotation-store.test.ts`
- Test: `src/__tests__/annotation-render.test.ts`
- Test: `src/__tests__/annotation-toolbar.test.tsx`
- Test: `src/__tests__/annotation-stage-text.test.tsx`

## Chunk 1: Model And Number Allocation

### Task 1: Add marker type and numbering

- [ ] **Step 1: Write failing store tests**

Add tests that create markers and assert marker numbers are `1`, `2`, `3` within one capture session, deletion decrements the current counter without renumbering existing marker objects, manual current-number adjustment affects the next marker, and reset restores the counter to `1`.

Run: `pnpm test src/__tests__/annotation-store.test.ts`

Expected: FAIL because marker numbering does not exist.

- [ ] **Step 2: Extend types**

Add `"marker"` to `ToolType` and `AnnotationObject["type"]`. Add optional `markerNumber`, `markerFill`, `markerTextColor`, and `markerBubbleFill`.

- [ ] **Step 3: Add store allocator**

Add actions such as `allocateMarkerNumber()`, `setCurrentMarkerNumber(n)`, and delete handling that decrements the current counter. The number must be undo-safe by storing it on the object. Existing markers must not be renumbered after deletion.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/annotation-store.test.ts`

Expected: PASS.

## Chunk 2: Tool Creation And Rendering

### Task 2: Implement marker tool

- [ ] **Step 1: Write failing render tests**

Test empty marker renders a circle and number only. Test marker with `text` renders a bubble rect and text node.

- [ ] **Step 2: Create `src/annotation/tools/marker.ts`**

Implement `onMarkerStart`, `onMarkerMove`, `onMarkerEnd`, and `renderMarkerObject`. A click should create a marker at the pointer location.

- [ ] **Step 3: Wire stage/render**

Add marker handlers to `TOOL_HANDLERS` in `Stage.tsx` and add marker rendering in `render.ts`.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/annotation-render.test.ts`

Expected: PASS.

## Chunk 3: UI And Editing

### Task 3: Add toolbar and property controls

- [ ] **Step 1: Write failing toolbar/panel tests**

Assert the annotation toolbar exposes `Marker`, and the marker property panel exposes fill, text color, and bubble background controls.

- [ ] **Step 2: Implement toolbar button**

Use a Lucide-compatible icon if available; otherwise use a compact inline badge icon with `1`.

- [ ] **Step 3: Implement property controls**

Reuse existing color picker controls where possible.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/annotation-toolbar.test.tsx src/__tests__/annotation-property-panel.test.tsx`

Expected: PASS.

### Task 4: Add marker text editing

- [ ] **Step 1: Write failing stage test**

Assert selecting or creating a marker opens an editor, entering text commits to the marker object, and empty text hides the bubble.

- [ ] **Step 2: Implement editor overlay**

Create marker-specific editing state in `Stage.tsx` or extract a focused component if the code becomes large.

- [ ] **Step 3: Verify full frontend tests**

Run: `pnpm test`

Expected: PASS.
