# Pin Window Controls Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hover-visible pin-window controls and enable in-place annotation editing for existing pinned screenshots.

**Architecture:** Keep all pin operations inside `PinRoute`, extend Rust `PinManager` for update/copy operations, and reuse the existing annotation stage plus horizontal annotation toolbar in an in-place edit mode without capture-session state.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Zustand, Konva, Vitest, Cargo tests.

---

## File Structure

- Modify: `src/routes/Pin.tsx`
- Modify or extract: reusable annotation stage/toolbar helpers if needed for Pin edit mode.
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/types.ts`
- Modify: `src-tauri/src/pin_mgr.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src/__tests__/pin-route.test.tsx`
- Test: `src/__tests__/ipc.test.ts`
- Test: Rust tests in `src-tauri/src/pin_mgr.rs` and `src-tauri/src/commands.rs`

## Chunk 1: Visible Pin Controls

### Task 1: Add hover/focus controls to `PinRoute`

- [ ] **Step 1: Write failing tests**

In `pin-route.test.tsx`, assert the pin window renders a hover/focus vertical toolbar with Edit, scale percentage dropdown, Close, Save, and Copy controls. Assert each control has an accessible tooltip/title. Assert the scale dropdown includes fine-grained `5%` options from `50%` through `300%`.

- [ ] **Step 2: Implement control bar**

Add a compact absolute-positioned vertical toolbar with Lucide icons, styled like the existing screenshot vertical toolbar. It should appear on hover and focus within the pin window. Define shared constants in or near `PinRoute`:

```ts
const PIN_SCALE_MIN = 0.5;
const PIN_SCALE_MAX = 3;
const PIN_SCALE_STEP = 0.05;
```

Generate dropdown options from those constants so the UI stays aligned with wheel behavior.

- [ ] **Step 3: Wire existing actions**

Close calls `closePin`; the scale dropdown calls `setPinScale` with percentage values; Save persists current annotation edits over the same pin; Copy copies the current pin composition.

- [ ] **Step 4: Normalize wheel zoom**

Replace the current `10%` wheel jump with the shared `5%` step. Add normalization/accumulation for high-resolution trackpad deltas so one small wheel event cannot trigger repeated jumps. Clamp to `50%..300%` before persisting.

- [ ] **Step 5: Verify**

Run: `pnpm test src/__tests__/pin-route.test.tsx`

Expected: PASS.

## Chunk 2: Pin Update Backend

### Task 2: Extend PinManager and IPC

- [ ] **Step 1: Write failing Rust tests**

Test updating a pin annotation path, copying a pin composition, and scaling without removing the pin entry.

Run: `cd src-tauri && cargo test pin_manager`

Expected: FAIL because update helpers do not exist.

- [ ] **Step 2: Add manager methods**

Add methods for `update_scale`, `update_annotation`, `pin_paths`, and any helper needed to build the current pin composition for copying.

- [ ] **Step 3: Add commands**

Add `update_pin_annotation` and `copy_pin` command stubs, register them in `generate_handler!`, and expose wrappers in `src/lib/ipc.ts`.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test src/__tests__/ipc.test.ts
cd src-tauri && cargo test pin_manager
```

Expected: PASS.

## Chunk 3: In-Place Pin Edit Mode

### Task 3: Build in-place editor mode

- [ ] **Step 1: Write failing route tests**

Extend `pin-route.test.tsx` to cover entering edit mode, rendering the horizontal annotation toolbar, saving over the same pin, copying the current composition, and canceling without mutation.

- [ ] **Step 2: Reuse annotation tools in `PinRoute`**

Render an annotation stage over the pinned image inside the original Pin window. Reuse the complete existing screenshot annotation toolset and horizontal toolbar. Avoid monitor hit-testing, capture-session events, and overlay selection behavior.

- [ ] **Step 3: Save over original pin**

Export annotation PNG and call `updatePinAnnotation`. The existing pin window should refresh its image stack without creating a new pin.

- [ ] **Step 4: Copy current composition**

Wire Copy to export the current pin composition and call `copyPin`.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm test src/__tests__/pin-route.test.tsx
cd src-tauri && cargo test
```

Expected: PASS.
