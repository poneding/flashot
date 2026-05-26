# Screenshot Image Adjustments Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-previewed screenshot base-image adjustments and apply them to copy/save/pin outputs while preserving annotation colors.

**Architecture:** Store adjustments in overlay state, preview them only on the frozen image layer, serialize them through IPC, and apply them to cropped RGBA data in Rust before annotation compositing.

**Tech Stack:** React, TypeScript, Zustand, Tauri IPC, Rust image buffer processing, Vitest, Cargo tests.

---

## File Structure

- Modify: `src/lib/types.ts`
- Modify: `src/overlay/state.ts`
- Modify: `src/overlay/FrozenLayer.tsx`
- Modify: `src/overlay/Toolbar.tsx`
- Create: `src/overlay/ImageAdjustmentsPanel.tsx`
- Modify: `src/lib/ipc.ts`
- Modify: `src-tauri/src/types.rs`
- Create: `src-tauri/src/image_adjust.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src/__tests__/overlay-state.test.ts`
- Test: `src/__tests__/toolbar.test.tsx`
- Test: `src/__tests__/ipc.test.ts`
- Test: Rust unit tests in `src-tauri/src/image_adjust.rs`

## Chunk 1: Frontend State And Preview

### Task 1: Add adjustment state

- [ ] **Step 1: Write failing store tests**

Assert defaults, reset behavior, clamping for brightness/contrast/saturation/sharpness, and that preview styles are intended for the base `FrozenLayer` only.

- [ ] **Step 2: Add `ImageAdjustments` type**

Add the type to `src/lib/types.ts` and overlay state.

- [ ] **Step 3: Add preview style helper**

Create a helper that maps adjustments to a CSS `filter` string for `FrozenLayer`.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/overlay-state.test.ts`

Expected: PASS.

### Task 2: Add toolbar panel

- [ ] **Step 1: Write failing toolbar tests**

Assert the screenshot toolbar has an image adjustments button and panel controls.

- [ ] **Step 2: Implement `ImageAdjustmentsPanel.tsx`**

Use toggles for grayscale/auto, sliders for numeric controls, and a reset icon button.

- [ ] **Step 3: Wire preview**

Apply filter styles to `FrozenLayer` while keeping annotations visually above it and unaffected.

- [ ] **Step 4: Verify**

Run: `pnpm test src/__tests__/toolbar.test.tsx`

Expected: PASS.

## Chunk 2: IPC And Rust Processing

### Task 3: Serialize adjustments through IPC

- [ ] **Step 1: Write failing IPC tests**

Assert `cropAndCopy`, `cropAndSave`, and `pinImage` send `adjustments`.

- [ ] **Step 2: Update wrappers and Rust command args**

Add optional `adjustments` parameters with defaults matching no-op behavior.

- [ ] **Step 3: Verify**

Run: `pnpm test src/__tests__/ipc.test.ts`

Expected: PASS.

### Task 4: Implement Rust image adjustment module

- [ ] **Step 1: Write failing Rust unit tests**

Test no-op, grayscale, brightness increase, contrast increase, saturation decrease, and sharpness no-op at zero.

- [ ] **Step 2: Implement `image_adjust.rs`**

Operate in-place on RGBA buffers. Keep alpha unchanged.

- [ ] **Step 3: Wire output path**

In `commands.rs`, apply adjustments after `crop_rgba` and before `composite_annotation` so only the base screenshot is processed.

- [ ] **Step 4: Verify**

Run:

```bash
cd src-tauri && cargo test image_adjust
cd src-tauri && cargo test
```

Expected: PASS.

## Chunk 3: Full Verification

### Task 5: Run final checks

- [ ] **Step 1: Frontend tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Rust checks**

Run: `cd src-tauri && cargo check && cargo test`

Expected: PASS.
