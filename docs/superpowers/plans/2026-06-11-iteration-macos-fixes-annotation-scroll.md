# Iteration Plan: macOS Capture Fixes + Annotation & Scroll Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three long-standing macOS capture bugs (crosshair cursor, utility-window popup on exit, dead X/C color-picker shortcuts) and ship three annotation/scroll features (marker badge/label split with leader line, smart-erase blur mode, scroll-capture performance).

**Architecture:** The three macOS bugs share one root: capture overlays are deliberately shown with `orderFrontRegardless` **without activating the app** (`overlay_window.rs:44-55`), so overlay webviews never own keyboard focus or cursor control, and session end hides overlays while the app *is* active (after the user's first click), letting AppKit promote Settings/About/Updater windows. We keep the non-activating design and fix each symptom at the native layer: session-scoped global hotkeys (the existing Esc pattern in `hotkey.rs`), deactivate-before-hide ordering, and native cursor push. Features build on the existing Konva annotation pipeline (`src/annotation/`) and the Rust scroll stitcher (`scroll_session.rs`/`scroll_stitch.rs`).

**Tech Stack:** Tauri 2 (Rust: objc, global-hotkey, image, xcap), React 18 + TypeScript, Zustand, Konva, Vitest, cargo test/criterion.

---

## Investigation findings (2026-06-11, dev branch @ f1dc949)

| Item | Status | Key evidence |
|---|---|---|
| B1 crosshair cursor on main screen | **Bug confirmed, root-cause hypothesis ranked** | Overlay never activates app (`overlay_window.rs:44-55`); CSS/`setCursorIcon` cursor needs key-window/active app on macOS WebKit |
| B2 utility windows pop up on Copy/Esc | **Root cause found** | `end_session` hides overlays **before** `schedule_app_deactivation_macos` (`window_mgr.rs:89-98`) |
| B3 X/C shortcuts dead / leak to active app | **Root cause found** | No webview has keyboard focus on macOS; Esc only works because it is a session-scoped **global hotkey** (`hotkey.rs:91-106,227-229`); X/C are webview `keydown` only (`Overlay.tsx:261-277`) |
| F1 marker badge/label split + leader line | New feature | Current marker renders badge+bubble in one draggable group (`tools/marker.ts:50-141`); `AnnotationObject.end` field free for label anchor |
| F2 smart-erase blur mode | New feature | `BlurMode` union + `applyBlur` dispatcher ready for a 4th mode (`types.ts:26`, `tools/blur.ts:104-145`) |
| F3 scroll perf + auto-pin on finish | **Auto-pin already shipped** (✓ button → `scrollPin()`, `ScrollChrome.tsx:141`); perf work remains | Hot path: full-canvas rescale + PNG encode + scalar base64 + `app.emit` broadcast every 100 ms (`scroll_session.rs:26-52`, `scroll_stitch.rs:299-325`) |
| F4 highlight selection constraints | **Already implemented & tested** — verification only | `transformerConfigForObject` (`Stage.tsx:372-386`), endpoint handles for straight highlights (`Stage.tsx:290-297`); tests at `annotation-stage-selection.test.tsx:505,530,642` (shipped with commit 6099385, v0.6.0-beta.2) |

**Workstream order** (tasks within a workstream are sequential; workstreams can interleave):

- **WS-A macOS capture fixes:** Task 1 (B3) → Task 2 (B2) → Task 3 (B1). Same files (`hotkey.rs`, `app_activation.rs`, `window_mgr.rs`, `overlay_window.rs`, `lib.rs`); B3 first because its outcome (keep non-activating design) constrains B1/B2.
- **WS-B annotation:** Task 4 (F4 verify, 15 min) → Task 5 (F2 smart erase) → Task 6 (F1 marker split, largest).
- **WS-C scroll:** Task 7 (F3 perf, bench-driven).
- **Chore:** Task 8 (update stale CLAUDE.md).

All commits follow Conventional Commits. Frontend tests: `pnpm test -- <file>`; Rust: `cd src-tauri && cargo test`.

---

### Task 1 (B3): Session-scoped global hotkeys for color-picker X / C on macOS

During region selection the app is intentionally never activated, so webview `keydown` for X/C never fires and the keystrokes fall through to the previously-active app (typing "x"/"c" into editors). Esc already works because it is registered as a **global hotkey only while a capture session is active** (`hotkey.rs:91-106`, `capture_cancel_hotkey()` = `HotKey::new(None, Code::Escape)`), and global-hotkey registration consumes the keystroke system-wide. Replicate that exact pattern for X and C on macOS, emitting the broadcast events the overlays already handle (`capture:color-format-toggle-requested`, `capture:color-copy-requested`, see `src/lib/ipc.ts:18-19` and `Overlay.tsx:190-237`).

Scope decisions:
- **macOS only** (`#[cfg(target_os = "macos")]` guards around registration). On Windows/Linux the overlay genuinely owns focus, the webview keydown path works, and double-firing a *toggle* is not idempotent.
- Hotkeys must be **disabled while annotation text input is active** (marker/text editing makes the overlay key and the user may type x/c). Hook the existing `begin_text_input_session` / `end_text_input_session` commands (they already call `overlay_window::prepare_overlay_text_input` / `restore_overlay_after_text_input`).

**Files:**
- Modify: `src-tauri/src/hotkey.rs` (register/unregister + `action_for_event`)
- Modify: `src-tauri/src/lib.rs` (hotkey event handler: emit the two events; enable/disable alongside `set_capture_cancel_hotkey`)
- Modify: `src-tauri/src/commands.rs` (`begin_text_input_session`/`end_text_input_session`: toggle color hotkeys)
- Test: `src-tauri/src/hotkey.rs` inline `#[cfg(test)]`

- [ ] **Step 1: Write failing Rust tests for the new hotkey actions**

In `hotkey.rs` tests module, alongside the existing `cancel_id` test:

```rust
#[test]
fn color_picker_hotkeys_map_to_actions_only_in_session() {
    let ids = RegisteredHotkeyIds { capture: 1, fullscreen: 2, active_window: 3 };
    assert_eq!(
        action_for_event(color_format_toggle_id(), ids, true),
        Some(HotkeyAction::ColorFormatToggle)
    );
    assert_eq!(
        action_for_event(color_copy_id(), ids, true),
        Some(HotkeyAction::ColorCopy)
    );
    assert_eq!(action_for_event(color_format_toggle_id(), ids, false), None);
    assert_eq!(action_for_event(color_copy_id(), ids, false), None);
}

#[test]
fn color_picker_hotkeys_are_plain_x_and_c() {
    use global_hotkey::hotkey::{Code, HotKey};
    assert_eq!(color_format_toggle_hotkey().id(), HotKey::new(None, Code::KeyX).id());
    assert_eq!(color_copy_hotkey().id(), HotKey::new(None, Code::KeyC).id());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test color_picker_hotkeys`
Expected: FAIL — `color_format_toggle_id`, `HotkeyAction::ColorFormatToggle` etc. not defined.

- [ ] **Step 3: Implement in `hotkey.rs`**

Mirror the `capture_cancel` field/methods exactly:

```rust
fn color_format_toggle_hotkey() -> HotKey { HotKey::new(None, Code::KeyX) }
fn color_copy_hotkey() -> HotKey { HotKey::new(None, Code::KeyC) }
pub fn color_format_toggle_id() -> u32 { color_format_toggle_hotkey().id() }
pub fn color_copy_id() -> u32 { color_copy_hotkey().id() }
```

Add `color_picker: Mutex<Option<(HotKey, HotKey)>>` to the service struct, plus:

```rust
pub fn set_color_picker_enabled(&self, enabled: bool) -> Result<()> {
    let mut cur = self.color_picker.lock();
    if enabled {
        if cur.is_some() { return Ok(()); }
        let x = color_format_toggle_hotkey();
        let c = color_copy_hotkey();
        self.mgr.register(x)?;
        if let Err(e) = self.mgr.register(c) {
            let _ = self.mgr.unregister(x);
            return Err(e.into());
        }
        *cur = Some((x, c));
    } else if let Some((x, c)) = cur.take() {
        let _ = self.mgr.unregister(x);
        let _ = self.mgr.unregister(c);
    }
    Ok(())
}
```

Expose a module-level `pub fn set_color_picker_enabled(enabled: bool) -> Result<()>` like the existing `set_capture_cancel_enabled` (`hotkey.rs:151-158`). Extend `HotkeyAction` with `ColorFormatToggle` and `ColorCopy`, and `action_for_event` (after the cancel branch):

```rust
if in_capture_session && event_id == color_format_toggle_id() {
    return Some(HotkeyAction::ColorFormatToggle);
}
if in_capture_session && event_id == color_copy_id() {
    return Some(HotkeyAction::ColorCopy);
}
```

- [ ] **Step 4: Wire emission + lifecycle in `lib.rs` and `commands.rs`**

In the global-hotkey event handler in `lib.rs` (where `HotkeyAction::CancelCapture` is handled), add:

```rust
HotkeyAction::ColorFormatToggle => {
    let _ = app_handle.emit("capture:color-format-toggle-requested", ());
}
HotkeyAction::ColorCopy => {
    let _ = app_handle.emit("capture:color-copy-requested", ());
}
```

(Event names must match `src/lib/ipc.ts:18-19` constants exactly.) Enable/disable next to every `set_capture_cancel_hotkey(app, true/false)` call site, macOS-gated:

```rust
fn set_color_picker_hotkeys(app: &AppHandle, enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = app.run_on_main_thread(move || {
            if let Err(e) = hotkey::set_color_picker_enabled(enabled) {
                tracing::warn!("color picker hotkey update failed: {e}");
            }
        }) {
            tracing::warn!("color picker hotkey dispatch failed: {e}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, enabled);
}
```

In `commands.rs` `begin_text_input_session` → disable; `end_text_input_session` → re-enable (only if a session is still active: check `mgr.in_session()`).

- [ ] **Step 5: Run tests + clippy**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: PASS, no warnings.

- [ ] **Step 6: Manual verification on macOS (multi-monitor if available)**

`pnpm tauri dev` → focus a text editor → trigger capture → without clicking, press X (picker format toggles, **nothing typed in the editor**), press C (color copied), Esc (session ends). Then: commit a selection, double-click a marker to edit text, type "xc" — characters must appear in the textarea.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/hotkey.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "fix: route color picker shortcuts through session hotkeys on macos"
```

---

### Task 2 (B2): Stop utility windows popping up when capture ends

`end_session` (`window_mgr.rs:89-98`) hides overlays first and only **then** schedules `NSApp deactivate`. After the user's first click on an overlay the app is active, so the instant the key overlay hides, AppKit promotes the next visible app window — an open Settings/About/Updater window — to key and brings it forward; the later deactivate doesn't undo the reorder. Prior attempts compensated with `orderBack:` and were reverted (guard tests at `app_activation.rs:62-74`, `window_mgr.rs:229-243` forbid that approach). The fix is ordering: **deactivate first, then hide overlays, atomically in one main-thread task.**

**Files:**
- Modify: `src-tauri/src/app_activation.rs` (new combined helper)
- Modify: `src-tauri/src/window_mgr.rs` (`end_session_deactivating_app` uses it; keep `end_session` for the save-dialog path)
- Test: inline tests in both files

- [ ] **Step 1: Write failing source-shape test**

In `window_mgr.rs` tests (the file already uses this source-assertion style):

```rust
#[test]
fn capture_end_deactivates_app_before_hiding_overlays_on_macos() {
    let source = include_str!("window_mgr.rs").replace("\r\n", "\n");
    let body = function_body(&source, "end_session_deactivating_app");
    assert!(
        body.contains("deactivate_then_hide_overlays_macos"),
        "macOS capture end must deactivate the app and hide overlays in one main-thread task, deactivate first",
    );
}
```

And in `app_activation.rs` tests:

```rust
#[test]
fn deactivate_then_hide_runs_deactivation_first() {
    let source = include_str!("app_activation.rs").replace("\r\n", "\n");
    let start = source.find("fn deactivate_then_hide_overlays_macos_on_main_thread").expect("combined helper missing");
    let body = &source[start..];
    let deactivate_pos = body.find("deactivate_app_macos_on_main_thread").expect("must deactivate");
    let hide_pos = body.find("hide_overlay_windows").expect("must hide overlays");
    assert!(deactivate_pos < hide_pos, "deactivation must run before overlay hiding");
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test deactivate`
Expected: FAIL — helper not found.

- [ ] **Step 3: Implement**

In `app_activation.rs`:

```rust
pub fn deactivate_then_hide_overlays_macos(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            deactivate_then_hide_overlays_macos_on_main_thread(&handle);
        }) {
            tracing::warn!("failed to schedule capture-end deactivation: {e}");
            return false;
        }
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}

#[cfg(target_os = "macos")]
fn deactivate_then_hide_overlays_macos_on_main_thread(app: &AppHandle) {
    deactivate_app_macos_on_main_thread();
    hide_overlay_windows(app);
}

pub(crate) fn hide_overlay_windows(app: &AppHandle) {
    for (_label, w) in app.webview_windows() {
        let label = w.label();
        if label.starts_with("overlay-chrome-") {
            let _ = w.close();
        } else if label.starts_with("overlay-") {
            #[cfg(target_os = "linux")]
            let _ = w.set_fullscreen(false);
            #[cfg(not(target_os = "linux"))]
            let _ = w.set_ignore_cursor_events(true);
            let _ = w.hide();
        }
    }
}
```

Move the body of `WindowMgr::hide_overlays` into `app_activation::hide_overlay_windows` (single source of truth) and rewrite in `window_mgr.rs`:

```rust
pub fn end_session(&self, app: &AppHandle) {
    self.clear_session_state();
    crate::app_activation::hide_overlay_windows(app);
    let _ = app.emit("capture:end", ());
}

pub fn end_session_deactivating_app(&self, app: &AppHandle) {
    self.clear_session_state();
    if !crate::app_activation::deactivate_then_hide_overlays_macos(app) {
        crate::app_activation::hide_overlay_windows(app);
    }
    let _ = app.emit("capture:end", ());
}
```

(`crop_and_save` keeps plain `end_session` + its own late `schedule_app_deactivation_macos` because the native save dialog needs the app active — unchanged behavior, `commands.rs:400-408`.)

- [ ] **Step 4: Run tests + clippy**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings`
Expected: PASS including the two pre-existing guard tests (no `orderBack:` compensation reintroduced).

- [ ] **Step 5: Manual verification on macOS**

Open Settings window and leave it visible behind other apps; also open About. Trigger capture → drag a selection → press Copy. Expected: overlay disappears, previously-active app regains focus, **Settings/About stay exactly where they were** (no raise, no focus). Repeat ending with Esc, with Pin, and from a scroll session (✓ button). Repeat with Settings *closed* — no regression.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/app_activation.rs src-tauri/src/window_mgr.rs
git commit -m "fix: deactivate app before hiding overlays on capture end"
```

---

### Task 3 (B1): Crosshair cursor on the main screen at session start

Symptom: when the session starts, the monitor under the pointer (typically the main screen) keeps the previous app's cursor (arrow/I-beam) instead of the crosshair until the user clicks. The frontend already does everything it can: `mode` enters `hover` immediately (`state.ts:157-176`), the root div gets CSS `cursor: crosshair`, and a `useEffect` calls `webviewWindow.setCursorIcon("crosshair")` (`Overlay.tsx:489-506`); a 50 ms poll seeds the cursor position without mouse events (`Overlay.tsx:313-347`). The remaining failure layer is native: with the app inactive and the overlay non-key (by design, `overlay_window.rs:44-55`), macOS/WebKit does not honor the window's cursor, and the previously-active app's cursor wins.

Fix: push the crosshair cursor at the AppKit level (`[[NSCursor crosshairCursor] set]` is process-global and works without activation) right after overlays are shown, from the same main-thread task — and verify which layers are actually broken before trusting any single patch. This task is verification-heavy by design.

**Files:**
- Modify: `src-tauri/src/overlay_window.rs` (cursor push helper + call from `show_platform_overlay`)
- Modify: `src-tauri/src/lib.rs` (`run_capture`: push once after all overlays shown)
- Test: inline test in `overlay_window.rs`

- [ ] **Step 1: Reproduce + instrument (no fix yet)**

On macOS with the pointer resting on the main screen, trigger capture without moving the mouse. Record: (a) does the crosshair appear? (b) does it appear after moving the mouse 1 px? (c) after clicking? Add temporary `tracing::info!` in `show_platform_overlay` and check the `setCursorIcon` promise result in `setNativeOverlayCursor` (`Overlay.tsx:100-106`) via console. Write findings into the PR description — if the cursor already works after Task 1/Task 2 landed (focus behavior changed), close this task with the evidence instead of patching blind.

- [ ] **Step 2: Write failing source-shape test**

In `overlay_window.rs` tests:

```rust
#[cfg(target_os = "macos")]
#[test]
fn macos_overlay_show_pushes_crosshair_cursor() {
    let source = include_str!("overlay_window.rs").replace("\r\n", "\n");
    let body = function_body(&source, "show_platform_overlay");
    assert!(
        body.contains("push_crosshair_cursor"),
        "showing a capture overlay must push the crosshair cursor without requiring app activation",
    );
}
```

- [ ] **Step 3: Implement the native cursor push**

In `overlay_window.rs` (macOS section):

```rust
#[cfg(target_os = "macos")]
fn push_crosshair_cursor() {
    use objc::{runtime::{Class, Object, Sel}, Message};
    unsafe {
        if let Some(cursor_class) = Class::get("NSCursor") {
            let cursor: Result<*mut Object, _> =
                cursor_class.send_message(Sel::register("crosshairCursor"), ());
            if let Ok(cursor) = cursor {
                if !cursor.is_null() {
                    let _ = (*cursor).send_message::<_, ()>(Sel::register("set"), ());
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn show_platform_overlay(window: &WebviewWindow) -> Result<()> {
    bring_platform_overlay_to_front(window)?;
    push_crosshair_cursor();
    Ok(())
}
```

Also export `pub fn push_capture_cursor()` (macOS: `push_crosshair_cursor`, other platforms: no-op) and call it once at the end of the overlay-show loop in `run_capture` (`lib.rs:690`, after the `for` loop) so the *last* cursor push wins after every monitor's overlay is up.

- [ ] **Step 4: Guard against the previous app re-grabbing the cursor**

If Step 1 showed the cursor reverting while stationary (e.g., NSTextView blink timers re-setting the I-beam), extend the existing 50 ms hover poll: in `Overlay.tsx` `refreshHoverFromCursor` success path, call `setNativeOverlayCursor(overlayCursor)` at most once per second while `mode === "hover"` and `document.hasFocus()` is false. Skip this step entirely if Step 1 shows a single push is stable — do not add the re-push speculatively.

- [ ] **Step 5: Run tests + clippy + manual matrix**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings && pnpm test`
Manual: trigger capture with the pointer resting on each monitor; crosshair must be visible immediately, switch to `move`/resize cursors over a committed selection, and restore the normal cursor after the session ends (verify Task 2's end path also restores the previous app's cursor).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/overlay_window.rs src-tauri/src/lib.rs src/routes/Overlay.tsx
git commit -m "fix: show crosshair cursor on session start without app activation"
```

---

### Task 4 (F4): Verify highlight selection constraints (already shipped)

Both requested constraints landed in commit 6099385 (released v0.6.0-beta.2):
- Freehand highlight → move-only transformer: `Stage.tsx:381` returns `{ useTransformer: true, rotateEnabled: false, enabledAnchors: [] }`.
- Straight highlight → endpoint-only handles like line: `isEndpointEditableObject` includes `isStraightHighlightObject` (`Stage.tsx:290-292`), handles limited to `["start","end"]` (`Stage.tsx:294-297`).

**Files:** none expected to change.

- [ ] **Step 1: Run the existing regression tests**

Run: `pnpm test -- annotation-stage-selection`
Expected: PASS, including `shows endpoint handles instead of a transformer for straight highlights` (:505), `updates straight highlight endpoints from edit handles` (:530), `uses a move-only transformer for freehand highlights` (:642).

- [ ] **Step 2: Manual check in `pnpm tauri dev`**

Draw a freehand highlight → select it: no resize anchors, no rotate handle, drag moves it. Draw a straight highlight → select it: only two endpoint circles, dragging an endpoint re-aims the line; body drag moves it. Note results in the iteration log.

- [ ] **Step 3: Close out**

No commit. Report to the user that F4 shipped in v0.6.0-beta.2 (their build may predate it); reopen with specifics only if the manual check exposes a gap (e.g., a stale anchor cursor) — file that as a new bug with a screenshot rather than expanding this task.

---

### Task 5 (F2): Smart-erase blur mode (content-aware fill from surrounding colors)

Add `"smart"` as a fourth `BlurMode`. The effect fills the region by blending colors sampled from the ring of pixels just **outside** the selection (Snipaste-style erase): each interior pixel is a distance-weighted lerp of the left/right and top/bottom ring colors, followed by one fast stackblur pass to mask banding. Everything stays in the existing frontend pipeline — `applyBlur` already re-runs on move/resize via `refreshBlurObjectNode` (`tools/blur.ts:225-260`), and export reuses the same Konva nodes (`export.ts`), so no Rust changes.

**Files:**
- Modify: `src/annotation/types.ts:26` (`BlurMode` union)
- Modify: `src/annotation/tools/blur.ts` (ring sampling + `smartErase` + `applyBlur` branch)
- Modify: `src/annotation/PropertyPanel.tsx:1784-1808` (mode option)
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (mode label)
- Test: `src/__tests__/annotation-smart-erase.test.ts` (new)

- [ ] **Step 1: Write failing tests for the pure algorithm**

```typescript
import { describe, expect, it } from "vitest";
import { smartErase } from "@/annotation/tools/blur";

function solidImage(w: number, h: number, rgba: [number, number, number, number]): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return img;
}

describe("smartErase", () => {
  it("fills the interior with the surrounding color for a uniform ring", () => {
    // 24x24 padded sample, pad=4: ring is white, interior junk
    const img = solidImage(24, 24, [255, 255, 255, 255]);
    for (let y = 4; y < 20; y++)
      for (let x = 4; x < 20; x++) img.data.set([0, 200, 0, 255], (y * 24 + x) * 4);
    const out = smartErase(img, 4);
    const center = (12 * 24 + 12) * 4;
    expect(out.data[center]).toBeGreaterThan(240);     // r ≈ white
    expect(out.data[center + 1]).toBeGreaterThan(240); // g
    expect(out.data[center + 2]).toBeGreaterThan(240); // b
  });

  it("blends horizontally between differing left/right edges", () => {
    const img = solidImage(24, 24, [0, 0, 0, 255]);
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 4; x++) img.data.set([255, 0, 0, 255], (y * 24 + x) * 4);   // left ring red
      for (let x = 20; x < 24; x++) img.data.set([0, 0, 255, 255], (y * 24 + x) * 4); // right ring blue
      img.data.set([255, 0, 0, 255], (y * 24 + 0) * 4);
    }
    const out = smartErase(img, 4);
    const center = (12 * 24 + 12) * 4;
    expect(out.data[center]).toBeGreaterThan(40);      // some red
    expect(out.data[center + 2]).toBeGreaterThan(40);  // some blue
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- annotation-smart-erase`
Expected: FAIL — `smartErase` is not exported.

- [ ] **Step 3: Implement `smartErase` in `tools/blur.ts`**

```typescript
// Input is the region EXPANDED by `pad` px on every side; the outer ring is
// the fill source, the interior gets replaced. Returns the same padded size.
export function smartErase(padded: ImageData, pad: number): ImageData {
  const { width, height, data } = padded;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  if (innerW <= 0 || innerH <= 0 || pad <= 0) return out;

  const px = (x: number, y: number) => (y * width + x) * 4;
  for (let y = pad; y < pad + innerH; y++) {
    const left = px(pad - 1, y);
    const right = px(pad + innerW, y);
    const ty = (y - pad + 0.5) / innerH;
    for (let x = pad; x < pad + innerW; x++) {
      const top = px(x, pad - 1);
      const bottom = px(x, pad + innerH);
      const tx = (x - pad + 0.5) / innerW;
      const i = px(x, y);
      for (let ch = 0; ch < 3; ch++) {
        const h = data[left + ch] * (1 - tx) + data[right + ch] * tx;
        const v = data[top + ch] * (1 - ty) + data[bottom + ch] * ty;
        // Weight the axis whose edges are nearer (sharper estimate).
        const wh = Math.min(tx, 1 - tx);
        const wv = Math.min(ty, 1 - ty);
        out.data[i + ch] = (h * wv + v * wh) / Math.max(wv + wh, 1e-6);
      }
      out.data[i + 3] = 255;
    }
  }
  return out;
}
```

Generalize the sampler: change `getBackgroundImageData(x, y, w, h)` to accept an optional `pad` (clamp the padded rect to the frozen image bounds and return the *actual* applied padding), then branch in `applyBlur`:

```typescript
if (mode === "smart") {
  const pad = 12;
  const sample = getBackgroundImageData(rx - pad, ry - pad, rw + pad * 2, rh + pad * 2);
  if (!sample) return null;
  const erased = smartErase(sample, pad);
  const canvas = document.createElement("canvas");
  canvas.width = rw; canvas.height = rh;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(erased, -pad, -pad); // draw interior only
  canvasRGBA(canvas, 0, 0, rw, rh, 4);  // soften banding
  return new Konva.Image({ x: rx, y: ry, width: rw, height: rh, image: canvas });
}
```

Update the `applyBlur` mode parameter type and `types.ts:26`: `export type BlurMode = "mosaic" | "gaussian" | "solid" | "smart";` — `refreshBlurObjectNode` needs no change (smart returns a `Konva.Image` like mosaic/gaussian). Note: edge clamping means a blur region touching the frame border falls back to whatever padding fits; with zero available ring on a side, reuse the opposite side's color (the lerp already degrades gracefully because the clamped sampler duplicates边).

- [ ] **Step 4: Add the mode option + i18n**

In `PropertyPanel.tsx` blur section (`:1784-1808`), add `"smart"` to the mode control's option list following the existing mosaic/gaussian/solid entries; hide the intensity stepper and solid-color picker when `mode === "smart"` (it has no parameters). i18n keys: `annotation.blurModeSmart` = "Smart erase" / "智能擦除" / "智慧擦除".

- [ ] **Step 5: Run all frontend tests + lint**

Run: `pnpm test && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Capture a region over text on a plain background → blur tool → smart mode → drag over a word: the word disappears into the background. Move and resize the region: fill recomputes. Copy → paste into Preview: erased result matches the live preview. Check a region flush against the selection edge.

- [ ] **Step 7: Commit**

```bash
git add src/annotation/types.ts src/annotation/tools/blur.ts src/annotation/PropertyPanel.tsx src/i18n src/__tests__/annotation-smart-erase.test.ts
git commit -m "feat: add smart erase blur mode"
```

---

### Task 6 (F1): Split marker into badge + label with leader line

Today `renderMarkerObject` (`tools/marker.ts:50-141`) draws the numbered badge and its text bubble in **one** draggable Konva group anchored at `obj.start`; the bubble sits at a fixed offset (`markerBubbleMetrics`, `markerStyle.ts`). New design:

- **Data model:** `obj.start` stays the badge anchor; **`obj.end` becomes the label anchor** (top-left of the label box, stage coordinates). Legacy objects (text but no `end`) get a derived default equal to today's bubble offset, so old annotations look unchanged: `defaultMarkerLabelAnchor(obj) = { x: start.x + badgeRadius + MARKER_BUBBLE_GAP, y: start.y - bubbleHeight / 2 }`.
- **Rendering:** one group (id = obj.id, **not** draggable) containing: `marker-connector` (Konva.Line from badge edge toward nearest label-box edge midpoint, stroke = badge fill, width 1.5, dash [4,3], opacity 0.9, hidden while label box overlaps the badge), `marker-badge-part` (sub-group: circle + number, `draggable: true`), `marker-label-part` (sub-group: rect + text, `draggable: true`). The label rect keeps the dark bubble fill but gains the glow: `stroke: markerFill, strokeWidth: 1.5, shadowColor: markerFill, shadowBlur: 10, shadowOpacity: 0.85`. The legacy pointer triangle is removed (the connector replaces it). Empty text ⇒ badge only, no connector (current behavior, `marker.ts:93-94`).
- **Interaction:** dragging a part moves only that part with the connector following live; selection stays whole-object (`transformerConfigForObject` for marker becomes `{ useTransformer: false, ... }` with no endpoint handles — the glow + connector already communicate selection; keep click/double-click behaviors at `Stage.tsx:1283-1291`).
- **Editing overlay:** `MarkerTextOverlay` positions the textarea at the label anchor and mirrors the glow (`boxShadow: 0 0 10px <markerFill>`, `border: 1.5px solid <markerFill>`).

**Files:**
- Modify: `src/annotation/markerStyle.ts` (label metrics + default anchor helper)
- Modify: `src/annotation/tools/marker.ts` (split rendering + `updateMarkerObjectNode`)
- Modify: `src/annotation/Stage.tsx` (part-drag persistence; marker transformer config)
- Modify: `src/annotation/MarkerTextOverlay.tsx` (anchor + glow)
- Test: extend `src/__tests__/annotation-render.test.ts`, `src/__tests__/annotation-stage-selection.test.tsx`

- [ ] **Step 1: Write failing render tests**

In `annotation-render.test.ts` (alongside the existing marker test at :127):

```typescript
it("renders marker badge and label as separately draggable parts with a connector", () => {
  const obj: AnnotationObject = {
    id: "marker-2", type: "marker", start: { x: 40, y: 40 }, end: { x: 140, y: 20 },
    markerNumber: 3, text: "step three",
    style: { ...DEFAULT_STYLE, markerFill: "#0099ff" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const group = renderObject(obj) as Konva.Group;
  const badge = group.findOne(".marker-badge-part") as Konva.Group;
  const label = group.findOne(".marker-label-part") as Konva.Group;
  const connector = group.findOne(".marker-connector") as Konva.Line;
  expect(group.draggable()).toBe(false);
  expect(badge.draggable()).toBe(true);
  expect(label.draggable()).toBe(true);
  expect(connector).toBeTruthy();
  const labelRect = label.findOne(".marker-label-box") as Konva.Rect;
  expect(labelRect.stroke()).toBe("#0099ff");
  expect(labelRect.shadowColor()).toBe("#0099ff");
});

it("derives a legacy label anchor when end is missing", () => {
  const obj: AnnotationObject = {
    id: "marker-3", type: "marker", start: { x: 40, y: 40 },
    markerNumber: 1, text: "legacy",
    style: { ...DEFAULT_STYLE },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const group = renderObject(obj) as Konva.Group;
  const label = group.findOne(".marker-label-part") as Konva.Group;
  expect(label.x()).toBeGreaterThan(0); // sits to the right of the badge like the old bubble
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test -- annotation-render`
Expected: FAIL — no `.marker-badge-part` / `.marker-label-part` nodes.

- [ ] **Step 3: Implement metrics + rendering**

`markerStyle.ts`: add

```typescript
export function markerLabelMetrics(text: string, fontSize = MARKER_DEFAULT_FONT_SIZE) {
  const textWidth = markerTextWidth(text, fontSize);
  const lineHeight = fontSize * MARKER_BUBBLE_LINE_HEIGHT;
  return {
    width: Math.max(MARKER_BUBBLE_MIN_WIDTH, textWidth + MARKER_BUBBLE_PADDING_X * 2),
    height: lineHeight + MARKER_BUBBLE_PADDING_Y * 2,
    lineHeight,
  };
}

export function defaultMarkerLabelAnchor(
  start: { x: number; y: number },
  text: string,
  fontSize = MARKER_DEFAULT_FONT_SIZE,
): { x: number; y: number } {
  const { height } = markerLabelMetrics(text, fontSize);
  return { x: start.x + markerBadgeRadius(fontSize) + MARKER_BUBBLE_GAP, y: start.y - height / 2 };
}
```

(`markerTextWidth` is module-private today — export it or keep the new helpers in the same file.) `tools/marker.ts`: rewrite `renderMarkerObject` to build the three named parts described above; badge sub-group at `start + transform`, label sub-group at `(obj.end ?? defaultMarkerLabelAnchor(start, text, fontSize)) + transform`; add

```typescript
export function markerConnectorPoints(
  badgeCenter: Point, badgeRadius: number, labelBox: { x: number; y: number; width: number; height: number },
): number[] | null {
  const cx = Math.max(labelBox.x, Math.min(badgeCenter.x, labelBox.x + labelBox.width));
  const cy = Math.max(labelBox.y, Math.min(badgeCenter.y, labelBox.y + labelBox.height));
  const dx = cx - badgeCenter.x, dy = cy - badgeCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= badgeRadius + 2) return null; // overlapping — hide connector
  const ux = dx / dist, uy = dy / dist;
  return [badgeCenter.x + ux * badgeRadius, badgeCenter.y + uy * badgeRadius, cx, cy];
}

export function updateMarkerObjectNode(group: Konva.Group, obj: AnnotationObject): void {
  // reposition connector from current part positions (called during part drag)
}
```

`onMarkerEnd` keeps `text: ""` and **no `end`**; the first text confirm sets it: in `Stage.tsx` `MarkerTextOverlay onConfirm` (`:1441-1444`), persist `resizeObject(id, { text, end: markerEditing.object.end ?? defaultMarkerLabelAnchor(...) })`.

- [ ] **Step 4: Wire part dragging in `Stage.tsx`**

`getObjectNodeFromHit` walks up to the first node with an `id()` (`Stage.tsx:388-397`) — part sub-groups have no id, so existing stage `dragstart/dragmove/dragend` (`:1049-1056,1090-1121`) treat a part drag as an object drag and would write a whole-object transform. Add marker-part special-casing:

```typescript
function markerPartFromTarget(node: Konva.Node | null): "badge" | "label" | null {
  let current: Konva.Node | null = node;
  while (current) {
    if (current.hasName("marker-badge-part")) return "badge";
    if (current.hasName("marker-label-part")) return "label";
    current = current.getParent();
  }
  return null;
}
```

- `dragmove`: if the dragged target is a marker part, call `updateMarkerObjectNode(group, obj)` to refresh the connector and skip the generic transform preview.
- `dragend` (the persistence handler at `:1049`): badge part → `resizeObject(obj.id, { start: { x: group.x() + badgePart.x(), y: group.y() + badgePart.y() } })` then zero the part offset; label part → `resizeObject(obj.id, { end: { x: group.x() + labelPart.x(), y: group.y() + labelPart.y() } })` likewise. (Bake positions into `start`/`end` and keep `transform` at zero so undo/redo (`commands.ts`) and export stay consistent — same baking pattern rect/ellipse already use, `:623-641`.)
- `transformerConfigForObject` (`:380`): marker → `{ useTransformer: false, rotateEnabled: false, enabledAnchors: [] }`.

Write a stage-level test in `annotation-stage-selection.test.tsx` mirroring the straight-highlight ones (:530): add a marker with text, simulate `dragend` on the label part, assert `objects[0].end` moved and `start` did not.

- [ ] **Step 5: Update `MarkerTextOverlay.tsx`**

Position from `object.end ?? defaultMarkerLabelAnchor(...)` instead of `markerBubbleMetrics().bubbleX/Y` (`:38-40`); drop the pointer-triangle div (`:96-110`); add `border: 1.5px solid <markerFill>` + `boxShadow: 0 0 10px <markerFill>` to the textarea style; size from `markerLabelMetrics`.

- [ ] **Step 6: Run the full frontend suite**

Run: `pnpm test && pnpm lint`
Expected: PASS — pay attention to `annotation-render.test.ts:127` (badge-only marker must still render without a connector) and the export test (`annotation-export.test.ts`).

- [ ] **Step 7: Manual verification**

Place a marker → type text → confirm: label appears beside the badge with colored glow border + dashed leader line in the badge color. Drag the label far away: line follows, badge fixed. Drag the badge: line follows, label fixed. Overlap label onto badge: connector hides. Double-click badge: editor opens at the label position. Undo/redo each drag. Copy result and verify the exported PNG matches (glow + line rendered).

- [ ] **Step 8: Commit**

```bash
git add src/annotation/markerStyle.ts src/annotation/tools/marker.ts src/annotation/Stage.tsx src/annotation/MarkerTextOverlay.tsx src/__tests__/annotation-render.test.ts src/__tests__/annotation-stage-selection.test.tsx
git commit -m "feat: split marker badge and label with leader line"
```

---

### Task 7 (F3): Scroll-capture performance

Auto-pin already exists (the only finish affordance is the ✓ button → `scrollPin()`, `ScrollChrome.tsx:136-146` → `commands.rs:1402`). The perf problem is the progress pipeline: every accepted frame (throttled to 100 ms, `scroll_session.rs:106-113`) runs `preview_stitched(640, 8192)` — a **full-canvas** per-pixel rescale (`scroll_stitch.rs:299-325`), PNG-encode of up to 640×8192, hand-rolled scalar base64 (`scroll_session.rs:135-161`), and an `app.emit` **broadcast to every webview**. Cost grows linearly with capture height while the chrome window only ever shows the bottom slice (`ScrollChrome.tsx:44-52`, bottom-anchored `<img>`). A bottom-crop encoder already exists: `preview_thumbnail` (`scroll_stitch.rs:268-297`).

Plan: benchmark first, then (1) emit a bottom-tail preview instead of the full canvas, (2) target the emit at the chrome window only, (3) use fast PNG compression. Also auto-finish on `MaxHeightReached` so the session pins instead of silently stalling.

**Files:**
- Create: `src-tauri/benches/scroll_stitch_bench.rs`
- Modify: `src-tauri/Cargo.toml` (`[[bench]]` entry)
- Modify: `src-tauri/src/scroll_stitch.rs` (tail preview sizing + fast PNG encode)
- Modify: `src-tauri/src/scroll_session.rs` (emit tail preview to the chrome window; auto-pin signal)
- Modify: `src/routes/ScrollChrome.tsx` (listen for max-height → `scrollPin()`)
- Test: existing inline tests in `scroll_stitch.rs` / `scroll_session.rs` (update the full-preview guard test), `src/__tests__/scroll-chrome.test.tsx`

- [ ] **Step 1: Add a criterion benchmark to quantify the hot path**

`src-tauri/benches/scroll_stitch_bench.rs`:

```rust
use criterion::{criterion_group, criterion_main, Criterion};
use flashot_lib::scroll_stitch::{ScrollStitcher, StitchConfig};

fn gradient_frame(width: u32, height: u32, seed: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            buf[i] = ((x + seed) % 256) as u8;
            buf[i + 1] = ((y + seed * 7) % 256) as u8;
            buf[i + 2] = ((x ^ y) % 256) as u8;
            buf[i + 3] = 255;
        }
    }
    buf
}

fn stitcher_at_height(width: u32, frame_h: u32, target_h: u32) -> ScrollStitcher {
    let mut s = ScrollStitcher::new(width, frame_h, gradient_frame(width, frame_h, 0), StitchConfig::default());
    let mut seed = 1;
    while s.height() < target_h {
        s.ingest(&gradient_frame(width, frame_h, seed * 40));
        seed += 1;
    }
    s
}

fn bench_preview(c: &mut Criterion) {
    for target_h in [2_000u32, 10_000, 30_000] {
        let s = stitcher_at_height(1280, 800, target_h);
        c.bench_function(&format!("preview_full_{target_h}"), |b| {
            b.iter(|| s.preview_stitched(640, 8192))
        });
        c.bench_function(&format!("preview_tail_{target_h}"), |b| {
            b.iter(|| s.preview_thumbnail(640, 1024))
        });
    }
}

fn bench_ingest(c: &mut Criterion) {
    let mut s = stitcher_at_height(1280, 800, 5_000);
    let frame = gradient_frame(1280, 800, 999);
    c.bench_function("ingest_1280x800", |b| b.iter(|| s.ingest(&frame)));
}

criterion_group!(benches, bench_preview, bench_ingest);
criterion_main!(benches);
```

Register in `Cargo.toml` next to the existing benches. Run: `cd src-tauri && cargo bench --bench scroll_stitch_bench`. Record numbers in the PR — they justify (or kill) each optimization below. If exports differ (e.g., `ScrollStitcher` not `pub` from the lib crate), make the minimal visibility change.

- [ ] **Step 2: Switch progress to a tail preview, emitted only to the chrome window**

`scroll_session.rs`: replace both `preview_stitched(PREVIEW_TARGET_WIDTH, PREVIEW_MAX_HEIGHT)` calls (`:49,:110`) with `preview_thumbnail(PREVIEW_TARGET_WIDTH, PREVIEW_TAIL_HEIGHT)` where `const PREVIEW_TAIL_HEIGHT: u32 = 1024;` (≥ 2× the tallest chrome viewport; the bottom-anchored `<img width:100%; height:auto>` shows identical pixels). `preview_thumbnail` already preserves aspect by deriving `crop_h` from the width ratio (`scroll_stitch.rs:275-277`) — the squashed-preview bug that motivated the full-canvas switch (commit 0aecc18) cannot recur. Replace `app.emit("scroll:progress", …)` with `app.emit_to(tauri::EventTarget::webview_window(format!("overlay-chrome-{monitor_id}")), "scroll:progress", …)` (thread `monitor_id` into `emit_scroll_progress`). Update the guard test `scroll_progress_uses_full_stitched_preview` (`scroll_session.rs:177-185`) to assert the *new* invariant instead:

```rust
#[test]
fn scroll_progress_sends_aspect_correct_tail_preview_to_chrome_window() {
    let source = include_str!("scroll_session.rs").replace("\r\n", "\n");
    assert!(source.contains("preview_thumbnail("), "progress should encode only the visible tail");
    assert!(source.contains("emit_to"), "progress must target the chrome window, not broadcast");
}
```

- [ ] **Step 3: Fast PNG encode for previews**

In both preview fns, replace `PngEncoder::new(&mut buf)` with

```rust
PngEncoder::new_with_quality(&mut buf, CompressionType::Fast, FilterType::Adaptive)
```

(`image::codecs::png::{CompressionType, FilterType}`). Re-run the bench; keep only if it wins meaningfully (record before/after).

- [ ] **Step 4: Auto-pin when max height is reached**

`scroll_session.rs` `IngestResult::MaxHeightReached` branch (`:125-129`): before breaking, `let _ = app.emit_to(chrome_target, "scroll:max-height", ());` (do **not** end the session from Rust — reuse the exact ✓ path so cleanup stays in one place). `ScrollChrome.tsx`: subscribe via a new `onScrollMaxHeight` wrapper in `src/lib/ipc.ts` and call `void scrollPin()` once. Extend `src/__tests__/scroll-chrome.test.tsx` with a test that fires the event and asserts `scrollPin` was invoked once (the file already mocks `@/lib/ipc`).

- [ ] **Step 5: Run everything**

Run: `cd src-tauri && cargo test && cargo clippy -- -D warnings && cargo bench --bench scroll_stitch_bench && cd .. && pnpm test && pnpm lint`
Expected: all PASS; bench shows tail preview cost flat vs. height (was linear).

- [ ] **Step 6: Manual verification**

Long-scroll a page to ≥15,000 px tall: preview stays smooth late in the capture (no stutter that worsens over time — compare against `main` build subjectively), ✓ pins the full image, scrolling past max height auto-pins. Esc mid-scroll still cancels cleanly (Task 2 path).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/benches/scroll_stitch_bench.rs src-tauri/Cargo.toml src-tauri/src/scroll_stitch.rs src-tauri/src/scroll_session.rs src/routes/ScrollChrome.tsx src/lib/ipc.ts src/__tests__/scroll-chrome.test.tsx
git commit -m "perf: encode tail-only scroll preview and auto-pin at max height"
```

---

### Task 8 (chore): Refresh CLAUDE.md module map

CLAUDE.md still documents `src/overlay/Crosshair.tsx` (deleted; cursor handling now lives in `src/lib/cursor.ts` + `Overlay.tsx`) and omits the annotation subsystem (`src/annotation/`), scroll capture (`scroll_session.rs`, `scroll_stitch.rs`, `ScrollChrome.tsx`), and `overlay_window.rs`/`app_activation.rs`.

- [ ] **Step 1:** Update the "Key Frontend Modules" / "Key Rust Modules" sections to match the file tree (one line per module, same style as existing entries). Remove the Crosshair bullets and stale "Performance Targets" line about the crosshair component; add a line documenting the macOS non-activating overlay design (`orderFrontRegardless`, session global hotkeys) so the B1–B3 fixes' invariants are recorded for future sessions.
- [ ] **Step 2:** Commit:

```bash
git add CLAUDE.md
git commit -m "docs: refresh module map in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** B1→Task 3, B2→Task 2, B3→Task 1, F1(marker split)→Task 6, F2(smart erase)→Task 5, F3(scroll perf + auto-preview)→Task 7 (auto-pin-on-finish verified shipped; auto-pin-on-max-height added), F4(highlight constraints)→Task 4 (verification — already shipped in 6099385). No gaps.
- **Known risks called out in-task:** B1 is verification-first (Step 1 may close it); B2's save-dialog path intentionally unchanged; Task 6 changes drag persistence semantics for markers only (baking into `start`/`end`, transform zeroed) — undo/redo covered by stage tests; Task 7 rewrites a guard test with an explicit replacement invariant.
- **Estimates:** Task 1 ≈ 1d, Task 2 ≈ 0.5d, Task 3 ≈ 0.5–1d, Task 4 ≈ 0.25d, Task 5 ≈ 1d, Task 6 ≈ 2–3d, Task 7 ≈ 1.5d, Task 8 ≈ 0.25d → **7–8.5 dev-days**, one iteration.
