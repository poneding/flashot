# Quick Shot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global quick-shot shortcuts that copy the active display or foreground window directly to the clipboard.

**Architecture:** Extend settings and hotkey routing from one capture shortcut to three screenshot actions. Add backend quick-shot helpers that reuse existing monitor capture, clipboard, crop, and platform window-probe code while bypassing the overlay session model.

**Tech Stack:** Rust, Tauri 2, global-hotkey, xcap, arboard, React, TypeScript, Vitest

---

## File Map

| File | Role |
|------|------|
| `src-tauri/src/settings_store.rs` | Store defaults, legacy migration, and serialized shortcut fields |
| `src-tauri/src/hotkey.rs` | Register and route multiple hotkey actions |
| `src-tauri/src/lib.rs` | Wire startup/settings hotkeys and quick-shot event handlers |
| `src-tauri/src/commands.rs` | Add reusable crop helpers if needed by quick-shot code |
| `src-tauri/src/window_probe/mod.rs` | Expose `active_window()` |
| `src-tauri/src/window_probe/macos.rs` | macOS foreground-window detection |
| `src-tauri/src/window_probe/windows.rs` | Windows foreground-window detection |
| `src-tauri/src/window_probe/linux.rs` | X11 foreground-window detection |
| `src/lib/types.ts` | Frontend settings type |
| `src/routes/Settings.tsx` | Three shortcut settings rows and defaults |
| `src/settings/HotkeyRecorder.tsx` | Platform-native display labels |
| `src/__tests__/settings.test.tsx` | Settings UI regression tests |
| `README.md` | User-facing shortcut documentation |
| `src/__tests__/readme-v0.test.ts` | README alignment test updates |

---

## Chunk 1: Settings And Frontend Labels

### Task 1: Settings model migration

**Files:**
- Modify: `src-tauri/src/settings_store.rs`

- [ ] **Step 1: Write failing tests**

Add tests that expect:

```rust
let settings = Settings::default();
assert_eq!(settings.capture_hotkey, expected_region_default());
assert_eq!(settings.fullscreen_hotkey, expected_fullscreen_default());
assert_eq!(settings.active_window_hotkey, expected_active_window_default());

let legacy: Settings = serde_json::from_str(r#"{"hotkey":"Cmd+Shift+B"}"#).unwrap();
assert_eq!(legacy.capture_hotkey, "Cmd+Shift+B");
assert_eq!(legacy.fullscreen_hotkey, default_fullscreen_hotkey());
assert_eq!(legacy.active_window_hotkey, default_active_window_hotkey());
```

Run: `cd src-tauri && cargo test settings_store`
Expected: FAIL because the new fields do not exist.

- [ ] **Step 2: Implement minimal settings fields**

Add `capture_hotkey`, `fullscreen_hotkey`, and `active_window_hotkey` fields with serde camelCase names. Keep accepting legacy `hotkey` via a custom deserialize helper or compatibility field that maps into `capture_hotkey`.

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test settings_store`
Expected: PASS.

### Task 2: Frontend settings rows

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/routes/Settings.tsx`
- Modify: `src/settings/HotkeyRecorder.tsx`
- Modify: `src/__tests__/settings.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Expect settings to render three shortcut rows named "Region capture", "Active screen quick shot", and "Active window quick shot". Expect `CommandOrControl+Shift+A` to display as `Cmd+Shift+A` on macOS and `Ctrl+Shift+A` elsewhere.

Run: `pnpm test src/__tests__/settings.test.tsx --run`
Expected: FAIL because only one hotkey row exists.

- [ ] **Step 2: Implement settings UI changes**

Update the `Settings` type and settings route to edit all three shortcut fields. Add a `formatHotkeyForPlatform()` helper in `HotkeyRecorder.tsx` and use it for display.

- [ ] **Step 3: Verify**

Run: `pnpm test src/__tests__/settings.test.tsx --run`
Expected: PASS.

---

## Chunk 2: Hotkey Routing

### Task 3: Multi-action hotkey service

**Files:**
- Modify: `src-tauri/src/hotkey.rs`

- [ ] **Step 1: Write failing tests**

Add tests for:

```rust
let ids = RegisteredHotkeyIds {
    capture: id_for("Cmd+Shift+A"),
    fullscreen: id_for("Cmd+Shift+F"),
    active_window: id_for("Cmd+Shift+W"),
};
assert_eq!(action_for_event(ids.fullscreen, ids, false), Some(HotkeyAction::CopyActiveDisplay));
assert_eq!(action_for_event(ids.active_window, ids, false), Some(HotkeyAction::CopyActiveWindow));
assert_eq!(action_for_event(ids.fullscreen, ids, true), None);
```

Run: `cd src-tauri && cargo test hotkey`
Expected: FAIL because routing only knows the capture id.

- [ ] **Step 2: Implement action map**

Replace the single current id with a `RegisteredHotkeyIds` struct and register all configured shortcuts. Route quick-shot actions only when no overlay session is active.

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test hotkey`
Expected: PASS.

---

## Chunk 3: Quick-Shot Backend

### Task 4: Geometry helpers

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests**

Add tests for selecting the monitor with the largest overlap for a foreground window, and for clipping a window rect to monitor-local coordinates.

Run: `cd src-tauri && cargo test quick_shot`
Expected: FAIL because helpers do not exist.

- [ ] **Step 2: Implement helpers**

Add private helpers for intersection area, active-monitor selection, and clipped monitor-local rect conversion.

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test quick_shot`
Expected: PASS.

### Task 5: Active display copy

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing source-level or helper tests**

Test that active-display quick shot chooses the monitor associated with the active window and uses a full-monitor rect.

Run: `cd src-tauri && cargo test quick_shot`
Expected: FAIL.

- [ ] **Step 2: Implement active-display command path**

Add `copy_active_display(app)` or equivalent internal async function. Capture monitors, resolve the active monitor, and call `clipboard::copy_image()` with the matching frame's full RGBA data.

- [ ] **Step 3: Verify**

Run: `cd src-tauri && cargo test quick_shot`
Expected: PASS.

### Task 6: Active window copy

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/window_probe/mod.rs`
- Modify: `src-tauri/src/window_probe/macos.rs`
- Modify: `src-tauri/src/window_probe/windows.rs`
- Modify: `src-tauri/src/window_probe/linux.rs`

- [ ] **Step 1: Write failing tests where practical**

Unit-test shared geometry and source-level wiring. Platform API calls are manually verified through `cargo check` on the host platform.

Run: `cd src-tauri && cargo test quick_shot`
Expected: FAIL until wiring exists.

- [ ] **Step 2: Implement `active_window()` per platform**

Reuse existing platform helpers wherever possible. Return an error when the platform cannot identify a foreground window.

- [ ] **Step 3: Implement active-window command path**

Capture monitors, select the monitor with the largest intersection, crop the clipped window rect from that frame, and copy to clipboard.

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo test quick_shot`
Expected: PASS.

---

## Chunk 4: Wiring And Documentation

### Task 7: App wiring and tray text

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tray.rs` if needed

- [ ] **Step 1: Wire startup/settings hotkeys**

Load all three settings shortcuts, register them together, and dispatch quick-shot actions from the hotkey event loop.

- [ ] **Step 2: Verify Rust**

Run: `cd src-tauri && cargo test`
Expected: PASS.

### Task 8: README alignment

**Files:**
- Modify: `README.md`
- Modify: `src/__tests__/readme-v0.test.ts`

- [ ] **Step 1: Write/update failing README test**

Expect README to mention active-screen and active-window quick-shot defaults, and expect it not to mention `CommandOrControl`.

Run: `pnpm test src/__tests__/readme-v0.test.ts --run`
Expected: FAIL.

- [ ] **Step 2: Update README**

Document the three default shortcuts with platform-native labels.

- [ ] **Step 3: Verify frontend tests**

Run: `pnpm test -- --run`
Expected: PASS.

### Task 9: Final verification

- [ ] Run: `pnpm lint`
- [ ] Run: `pnpm test -- --run`
- [ ] Run: `cd src-tauri && cargo test`
- [ ] Run: `cd src-tauri && cargo check`

Expected: all pass.

