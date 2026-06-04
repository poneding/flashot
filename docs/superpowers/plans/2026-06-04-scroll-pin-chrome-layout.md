# Scroll Pin Chrome Layout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine Pin toolbar alignment and scrolling screenshot chrome so the scroll preview sits right-lower with edge fallback, shows an initial selection preview, and exposes an in-selection Check button only after real scrolling.

**Architecture:** Keep layout behavior split along existing ownership boundaries: backend code positions the separate scroll chrome window, `ScrollChromeRoute` renders the preview panel contents, and `OverlayRoute` renders in-selection scroll guidance and completion affordances. Reuse existing progress events and IPC wrappers, adding only an initial progress emission and small geometry helpers where needed.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Zustand, Vitest, Cargo tests.

**Spec Reference:** `docs/superpowers/specs/2026-06-04-scroll-pin-chrome-layout-design.md`

---

## File Structure

- Modify: `src-tauri/src/commands.rs`
  - Add/test a logical scroll chrome positioning helper.
  - Update `spawn_scroll_chrome` to prefer right-lower, flip left-lower, then clamp.
  - Emit the initial selected-region preview after `ScrollStitcher` is created.
- Modify: `src-tauri/src/scroll_session.rs`
  - Expose a helper to build/emit `scroll:progress` payloads so both initial and appended progress use one path.
- Modify: `src/lib/types.ts`
  - Keep existing `ScrollProgress` shape unless a strictly needed flag emerges. Prefer `frames > 0` for accepted scrolling.
- Modify: `src/lib/ipc.ts`
  - Keep `onScrollProgress` as the shared progress adapter.
- Modify: `src/routes/Overlay.tsx`
  - Replace `ScrollStartupStatus` with in-selection top hint and bottom Check affordance.
  - Subscribe to scroll progress while `mode === "scrolling"` and call `scrollPin()` from Check.
- Modify: `src/routes/ScrollChrome.tsx`
  - Remove the full bottom action bar.
  - Render the transparent preview panel, bottom-centered status pill, and initial progress preview.
- Modify: `src/routes/Pin.tsx`
  - Align vertical Pin controls top edge to content edge.
  - Keep Pin edit annotation toolbar aligned to the same content edge.
- Test: `src/__tests__/scroll-chrome.test.tsx`
- Test: `src/__tests__/overlay-route.test.tsx`
- Test: `src/__tests__/pin-route.test.tsx`
- Test: `src-tauri/src/commands.rs` inline tests
- Optional Test: `src/__tests__/ipc.test.ts` only if `ScrollProgress` payload shape changes.

---

## Chunk 1: Backend Scroll Chrome Position And Initial Preview

### Task 1: Add tests for scroll chrome right-lower placement and fallback

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write failing tests for a pure positioning helper**

Add a small pure helper test module near the existing `commands.rs` tests. The helper under test should be named `scroll_chrome_position` or similar and should accept logical monitor dimensions, logical selection rect, chrome size, and gap.

Add tests equivalent to:

```rust
#[test]
fn scroll_chrome_position_prefers_right_lower_side() {
    let pos = scroll_chrome_position(
        Rect { x: 100, y: 120, width: 300, height: 240 },
        Rect { x: 0, y: 0, width: 1200, height: 800 },
        (320.0, 180.0),
        12.0,
    );

    assert_eq!(pos.x, 412.0);
    assert_eq!(pos.y, 180.0);
}

#[test]
fn scroll_chrome_position_flips_left_when_right_overflows() {
    let pos = scroll_chrome_position(
        Rect { x: 840, y: 120, width: 300, height: 240 },
        Rect { x: 0, y: 0, width: 1200, height: 800 },
        (320.0, 180.0),
        12.0,
    );

    assert_eq!(pos.x, 508.0);
    assert_eq!(pos.y, 180.0);
}

#[test]
fn scroll_chrome_position_clamps_inside_monitor_when_neither_side_fits() {
    let pos = scroll_chrome_position(
        Rect { x: 40, y: 720, width: 1140, height: 60 },
        Rect { x: 0, y: 0, width: 1200, height: 800 },
        (320.0, 180.0),
        12.0,
    );

    assert_eq!(pos.x, 868.0);
    assert_eq!(pos.y, 620.0);
}
```

Use `f64` or a small struct for the returned coordinates. If `Rect`'s integer fields make the helper awkward, define a private `LogicalChromePosition { x: f64, y: f64 }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test scroll_chrome_position`

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Implement the pure helper**

Add helper code near `spawn_scroll_chrome`:

```rust
#[derive(Clone, Copy, Debug, PartialEq)]
struct LogicalChromePosition {
    x: f64,
    y: f64,
}

fn clamp_f64(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        return min;
    }
    value.max(min).min(max)
}

fn scroll_chrome_position(
    selection: Rect,
    monitor: Rect,
    chrome_size: (f64, f64),
    gap: f64,
) -> LogicalChromePosition {
    let chrome_w = chrome_size.0;
    let chrome_h = chrome_size.1;
    let monitor_left = monitor.x as f64;
    let monitor_top = monitor.y as f64;
    let monitor_right = monitor_left + monitor.width as f64;
    let monitor_bottom = monitor_top + monitor.height as f64;
    let selection_left = monitor_left + selection.x as f64;
    let selection_top = monitor_top + selection.y as f64;
    let selection_right = selection_left + selection.width as f64;
    let selection_bottom = selection_top + selection.height as f64;
    let lower_top = clamp_f64(selection_bottom - chrome_h, monitor_top + gap, monitor_bottom - chrome_h - gap);

    let right_x = selection_right + gap;
    if right_x + chrome_w <= monitor_right - gap {
        return LogicalChromePosition { x: right_x, y: lower_top };
    }

    let left_x = selection_left - chrome_w - gap;
    if left_x >= monitor_left + gap {
        return LogicalChromePosition { x: left_x, y: lower_top };
    }

    LogicalChromePosition {
        x: clamp_f64(selection_right + gap, monitor_left + gap, monitor_right - chrome_w - gap),
        y: lower_top,
    }
}
```

Adjust expected test values if the monitor origin is nonzero in the helper inputs.

- [ ] **Step 4: Run targeted Rust tests**

Run: `cd src-tauri && cargo test scroll_chrome_position`

Expected: PASS.

### Task 2: Use the helper in `spawn_scroll_chrome`

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write a structure test for `spawn_scroll_chrome`**

Extend existing string-based tests in `commands.rs` to assert that `spawn_scroll_chrome` calls the new helper and no longer uses the old below/bottom-right fallback language.

Example:

```rust
#[test]
fn spawn_scroll_chrome_uses_right_lower_position_helper() {
    let body = function_body(&include_str!("commands.rs").replace("\r\n", "\n"), "spawn_scroll_chrome");

    assert!(body.contains("scroll_chrome_position("));
    assert!(!body.contains("sel_logical_bottom + gap + chrome_h"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test spawn_scroll_chrome_uses_right_lower_position_helper`

Expected: FAIL because `spawn_scroll_chrome` still uses the old preference order.

- [ ] **Step 3: Update `spawn_scroll_chrome`**

Inside `spawn_scroll_chrome`:

- Keep `chrome_w` and `chrome_h` constants.
- Convert `phys_rect` into a monitor-local logical `Rect`.
- Pass monitor-local logical selection and monitor logical bounds into `scroll_chrome_position`.
- Use the returned global logical coordinates with `.position(x, y)`.

Implementation sketch:

```rust
let scale = mon.scale_factor as f64;
let logical_selection = Rect {
    x: (phys_rect.x as f64 / scale).round() as i32,
    y: (phys_rect.y as f64 / scale).round() as i32,
    width: (phys_rect.width as f64 / scale).round().max(1.0) as u32,
    height: (phys_rect.height as f64 / scale).round().max(1.0) as u32,
};
let logical_monitor = Rect {
    x: mon.rect.x,
    y: mon.rect.y,
    width: mon.rect.width,
    height: mon.rect.height,
};
let pos = scroll_chrome_position(logical_selection, logical_monitor, (chrome_w, chrome_h), 12.0);
let (x, y) = (pos.x, pos.y);
```

If `mon.rect` is already global logical and `phys_rect` is monitor-local physical, ensure the helper adds monitor origin exactly once.

- [ ] **Step 4: Run targeted Rust tests**

Run: `cd src-tauri && cargo test scroll_chrome`

Expected: PASS for positioning and existing scroll cleanup tests.

### Task 3: Emit an initial progress payload before user scrolls

**Files:**
- Modify: `src-tauri/src/scroll_session.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write a Rust source test for initial progress emission**

Add a `commands.rs` test that inspects `start_scroll_session` and asserts initial progress emission happens after `ScrollStitcher::new` and before `spawn_loop`.

Example:

```rust
#[test]
fn start_scroll_session_emits_initial_progress_before_capture_loop() {
    let source = include_str!("commands.rs").replace("\r\n", "\n");
    let body = function_body(&source, "start_scroll_session");
    let stitcher_idx = body.find("ScrollStitcher::new").unwrap();
    let initial_progress_idx = body.find("emit_initial_progress").unwrap();
    let loop_idx = body.find("spawn_loop").unwrap();

    assert!(stitcher_idx < initial_progress_idx && initial_progress_idx < loop_idx);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test start_scroll_session_emits_initial_progress_before_capture_loop`

Expected: FAIL because no initial progress is emitted.

- [ ] **Step 3: Extract reusable progress payload emission**

In `src-tauri/src/scroll_session.rs`, make `ProgressPayload` usable by `commands.rs` and add a helper:

```rust
#[derive(serde::Serialize, Clone)]
pub(crate) struct ProgressPayload {
    frames: u32,
    height: u32,
    preview_png_base64: String,
    last_score: f32,
}

pub(crate) fn emit_scroll_progress(
    app: &AppHandle,
    frames: u32,
    height: u32,
    preview_png: Vec<u8>,
    last_score: f32,
) {
    let _ = app.emit(
        "scroll:progress",
        ProgressPayload {
            frames,
            height,
            preview_png_base64: base64_encode(&preview_png),
            last_score,
        },
    );
}
```

Keep `base64_encode` private if the helper lives in the same module.

- [ ] **Step 4: Use the helper in the existing capture loop**

Replace the inline `app.emit("scroll:progress", ProgressPayload { ... })` block in `spawn_loop` with:

```rust
emit_scroll_progress(&app, frames_accepted, new_height, thumb, score);
```

- [ ] **Step 5: Emit the initial progress from `start_scroll_session`**

After the `ScrollStitcher::new(...)` Arc is created and before `spawn_loop(...)`, read the stitcher once:

```rust
{
    let s = stitcher.lock().await;
    crate::scroll_session::emit_scroll_progress(
        &app,
        0,
        s.height(),
        s.preview_thumbnail(PREVIEW_TARGET_WIDTH, PREVIEW_TARGET_HEIGHT),
        1.0,
    );
}
```

If `PREVIEW_TARGET_WIDTH`/`PREVIEW_TARGET_HEIGHT` are private to `scroll_session.rs`, either expose a helper `emit_initial_progress(&app, &ScrollStitcher)` from `scroll_session.rs` or make constants `pub(crate)`. Prefer a helper to avoid leaking constants.

- [ ] **Step 6: Run targeted Rust tests**

Run: `cd src-tauri && cargo test start_scroll_session_emits_initial_progress_before_capture_loop scroll_loop_does_not_emit_bottom_detection`

Expected: PASS.

- [ ] **Step 7: Commit Chunk 1**

```bash
git add src-tauri/src/commands.rs src-tauri/src/scroll_session.rs
git commit -m "fix: position scroll chrome and emit initial preview"
```

---

## Chunk 2: Overlay Scroll Hint And Check Completion

### Task 4: Extend IPC mocks and add overlay tests for scroll guidance

**Files:**
- Modify: `src/__tests__/overlay-route.test.tsx`
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Update the overlay test mock surface**

In `src/__tests__/overlay-route.test.tsx`, import and mock:

```ts
onScrollProgress: vi.fn().mockResolvedValue(vi.fn()),
scrollPin: vi.fn().mockResolvedValue("pin-1"),
```

Also add a hoisted callback holder:

```ts
scrollProgress: undefined as undefined | ((p: ScrollProgress) => void),
```

The mock implementation should capture the callback:

```ts
onScrollProgress: vi.fn((cb: (p: ScrollProgress) => void) => {
  ipcListeners.scrollProgress = cb;
  return Promise.resolve(vi.fn());
}),
```

- [ ] **Step 2: Write failing overlay tests**

Add tests:

```ts
it("shows the scroll hint inside the selection after scrolling mode starts", async () => {
  const selection = { x: 100, y: 120, width: 240, height: 160 };
  useOverlay.getState().commit(selection);
  render(<OverlayRoute />);

  fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

  await waitFor(() => {
    expect(useOverlay.getState().mode).toBe("scrolling");
  });
  expect(screen.getByText("Scroll the window below to capture…")).toBeTruthy();
});

it("hides the scroll check before accepted scroll progress and shows it after frames increase", async () => {
  const selection = { x: 100, y: 120, width: 240, height: 160 };
  useOverlay.getState().commit(selection);
  render(<OverlayRoute />);
  fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

  await waitFor(() => expect(ipcListeners.scrollProgress).toBeDefined());
  act(() => {
    ipcListeners.scrollProgress?.({
      frames: 0,
      height: 160,
      previewDataUrl: "data:image/png;base64,initial",
      lastScore: 1,
    });
  });
  expect(screen.queryByRole("button", { name: "Finish scrolling screenshot" })).toBeNull();

  act(() => {
    ipcListeners.scrollProgress?.({
      frames: 1,
      height: 260,
      previewDataUrl: "data:image/png;base64,next",
      lastScore: 0.95,
    });
  });

  expect(screen.getByRole("button", { name: "Finish scrolling screenshot" })).toBeTruthy();
});

it("pins the scroll result when the in-selection check is clicked", async () => {
  const selection = { x: 100, y: 120, width: 240, height: 160 };
  useOverlay.getState().commit(selection);
  render(<OverlayRoute />);
  fireEvent.click(screen.getByRole("button", { name: "Scrolling screenshot" }));

  await waitFor(() => expect(ipcListeners.scrollProgress).toBeDefined());
  act(() => {
    ipcListeners.scrollProgress?.({
      frames: 2,
      height: 320,
      previewDataUrl: "data:image/png;base64,next",
      lastScore: 0.95,
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "Finish scrolling screenshot" }));

  await waitFor(() => {
    expect(scrollPin).toHaveBeenCalledTimes(1);
  });
});
```

Adjust visible text if the current English dictionary uses ASCII `...` instead of ellipsis. Prefer using the translator string already present in the DOM.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/__tests__/overlay-route.test.tsx`

Expected: FAIL because the route still renders `ScrollStartupStatus` and has no in-selection Check.

### Task 5: Implement the scroll hint and Check affordance

**Files:**
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Import progress and pin helpers**

Update imports:

```ts
import { onScrollProgress, scrollPin } from "@/lib/ipc";
import type { ScrollProgress } from "@/lib/types";
import { CheckIcon } from "lucide-react";
```

If `CheckIcon` already conflicts with another import, merge it into the existing lucide import.

- [ ] **Step 2: Track accepted scroll progress in `OverlayRoute`**

Add local state:

```ts
const [scrollFrames, setScrollFrames] = useState(0);
```

Reset it when a new capture starts or capture ends. Add an effect:

```ts
useEffect(() => {
  if (mode !== "scrolling") {
    setScrollFrames(0);
    return;
  }
  const sub = onScrollProgress((progress: ScrollProgress) => {
    setScrollFrames(progress.frames);
  });
  return () => {
    sub.then((unlisten) => unlisten()).catch(() => {});
  };
}, [mode]);
```

This effect intentionally treats the backend's initial payload (`frames = 0`) as "not yet actually scrolled".

- [ ] **Step 3: Replace `ScrollStartupStatus` rendering**

Remove the `mode === "scrollStarting"` `ScrollStartupStatus` use. Render a new component when `mode === "scrolling" && selection && monitorRect`:

```tsx
<ScrollCaptureAffordance
  selection={selection}
  monitorRect={{ x: 0, y: 0, width: monitorRect.width, height: monitorRect.height }}
  locale={locale}
  showCheck={scrollFrames > 0}
  onFinish={handleScrollFinish}
/>
```

Keep the top hint visible briefly. A simple first pass can keep it visible for `1800ms` after entering scrolling mode using component-local state and `setTimeout`.

- [ ] **Step 4: Add `handleScrollFinish`**

Inside `OverlayRoute`:

```ts
const handleScrollFinish = async () => {
  try {
    await scrollPin();
  } catch (error) {
    console.warn("Failed to pin scrolling screenshot", error);
  }
};
```

Do not call `stopScrollSession(true)` here; `scrollPin()` already materializes, closes chrome, and ends the capture session.

- [ ] **Step 5: Implement `ScrollCaptureAffordance`**

Replace or remove the old `ScrollStartupStatus` function with:

```tsx
function ScrollCaptureAffordance({
  selection,
  monitorRect,
  locale,
  showCheck,
  onFinish,
}: {
  selection: Rect;
  monitorRect: Rect;
  locale: Locale;
  showCheck: boolean;
  onFinish: () => void | Promise<void>;
}) {
  const t = createTranslator(locale);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    setHintVisible(true);
    const timer = window.setTimeout(() => setHintVisible(false), 1800);
    return () => window.clearTimeout(timer);
  }, [selection.x, selection.y, selection.width, selection.height]);

  const centerX = selection.x + selection.width / 2;
  const hintWidth = 240;
  const checkSize = 42;
  const hintLeft = Math.min(Math.max(centerX - hintWidth / 2, 8), Math.max(8, monitorRect.width - hintWidth - 8));
  const hintTop = Math.min(selection.y + 12, Math.max(8, monitorRect.height - 28));
  const checkLeft = Math.min(Math.max(centerX - checkSize / 2, 8), Math.max(8, monitorRect.width - checkSize - 8));
  const checkTop = Math.min(
    Math.max(selection.y + selection.height - checkSize - 14, 8),
    Math.max(8, monitorRect.height - checkSize - 8),
  );

  return (
    <>
      {hintVisible && (
        <div role="status" style={{ ...scrollHintStyle, left: hintLeft, top: hintTop, width: hintWidth }}>
          {t("scroll.prompt")}
        </div>
      )}
      {showCheck && (
        <button
          type="button"
          aria-label={t("scroll.finishPin")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => void onFinish()}
          style={{ ...scrollCheckStyle, left: checkLeft, top: checkTop }}
        >
          <CheckIcon size={24} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
```

Add `scroll.finishPin` to the dictionaries in Chunk 3 if the test uses localized accessible names. Until that is added, this task can use the English string directly, but the final implementation should localize it.

- [ ] **Step 6: Run overlay tests**

Run: `pnpm test src/__tests__/overlay-route.test.tsx`

Expected: PASS for new overlay tests and existing route tests.

- [ ] **Step 7: Commit Chunk 2**

```bash
git add src/routes/Overlay.tsx src/__tests__/overlay-route.test.tsx
git commit -m "feat: add in-selection scroll completion affordance"
```

---

## Chunk 3: Scroll Chrome Panel UI And Localization

### Task 6: Add localization for scroll finish action

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Test: `src/__tests__/i18n.test.ts` if it asserts key parity

- [ ] **Step 1: Write or update i18n test if needed**

Run: `pnpm test src/__tests__/i18n.test.ts`

Expected: PASS currently. If the suite has key-parity checks, it will catch missing keys after implementation.

- [ ] **Step 2: Add key values**

Add:

```ts
"scroll.finishPin": "Finish scrolling screenshot",
```

```ts
"scroll.finishPin": "完成滚动截图",
```

```ts
"scroll.finishPin": "完成捲動截圖",
```

- [ ] **Step 3: Run i18n tests**

Run: `pnpm test src/__tests__/i18n.test.ts`

Expected: PASS.

### Task 7: Rework `ScrollChromeRoute` to translucent preview panel

**Files:**
- Modify: `src/routes/ScrollChrome.tsx`
- Modify: `src/__tests__/scroll-chrome.test.tsx`

- [ ] **Step 1: Write failing tests for new panel behavior**

Update `scroll-chrome.test.tsx`:

- Remove or rewrite the test that clicks `Done`.
- Keep `scrollPin` mocked for compatibility but assert the chrome route no longer renders `Done`, `Cancel`, `Copy`, or `Save` buttons.
- Capture the `onScrollProgress` callback and emit progress.
- Assert status appears in a bottom-centered pill.
- Assert the preview image renders from `progress.previewDataUrl`.

Example mock:

```ts
const scrollProgressListener = vi.hoisted(() => ({
  current: undefined as undefined | ((p: ScrollProgress) => void),
}));

onScrollProgress: vi.fn((cb: (p: ScrollProgress) => void) => {
  scrollProgressListener.current = cb;
  return Promise.resolve(vi.fn());
}),
```

Example tests:

```ts
it("renders a translucent preview panel without action buttons", () => {
  const { container } = render(<ScrollChromeRoute />);
  const chrome = container.firstElementChild as HTMLElement;

  expect(chrome.style.background).toBe("rgba(24, 24, 24, 0.62)");
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("floats progress status at the bottom center over the preview", async () => {
  render(<ScrollChromeRoute />);
  await waitFor(() => expect(scrollProgressListener.current).toBeDefined());

  act(() => {
    scrollProgressListener.current?.({
      frames: 4,
      height: 1280,
      previewDataUrl: "data:image/png;base64,abc",
      lastScore: 0.95,
    });
  });

  const status = screen.getByText("4 frames · 1280px");
  expect(status).toHaveAttribute("data-scroll-status-pill");
  expect(screen.getByAltText("")).toHaveAttribute("src", "data:image/png;base64,abc");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/scroll-chrome.test.tsx`

Expected: FAIL because the old full action bar still renders.

- [ ] **Step 3: Implement new chrome route layout**

In `ScrollChromeRoute`:

- Remove `busy`, `finalize`, `onDone`, and `onCancel` if no longer used.
- Keep `onScrollProgress` subscription.
- Root should be the panel itself:

```tsx
<div
  style={{
    width: "100vw",
    height: "100vh",
    boxSizing: "border-box",
    pointerEvents: "auto",
    background: "rgba(24, 24, 24, 0.62)",
    color: "white",
    borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
    boxShadow: "0 12px 36px rgba(0,0,0,0.34)",
    border: SCREENSHOT_TOOLBAR_BORDER,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    overflow: "hidden",
    position: "relative",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  }}
>
```

- Render preview image bottom-aligned:

```tsx
{progress?.previewDataUrl ? (
  <img
    src={progress.previewDataUrl}
    alt=""
    draggable={false}
    style={{
      position: "absolute",
      left: 0,
      bottom: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "bottom center",
      transition: "transform 120ms ease-out",
      userSelect: "none",
    }}
  />
) : (
  <div aria-hidden="true" style={translucentPreviewFallbackStyle} />
)}
```

- Render status pill:

```tsx
<div data-scroll-status-pill style={scrollStatusPillStyle}>
  {statusText}
</div>
```

- [ ] **Step 4: Run scroll chrome tests**

Run: `pnpm test src/__tests__/scroll-chrome.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Chunk 3**

```bash
git add src/routes/ScrollChrome.tsx src/__tests__/scroll-chrome.test.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat: simplify scroll capture preview chrome"
```

---

## Chunk 4: Pin Toolbar Alignment

### Task 8: Align Pin window toolbars to content edge

**Files:**
- Modify: `src/routes/Pin.tsx`
- Modify: `src/__tests__/pin-route.test.tsx`

- [ ] **Step 1: Write failing tests for Pin control offsets**

In `pin-route.test.tsx`, add or update tests after controls become visible:

```ts
it("aligns the pin controls top edge with the content edge", async () => {
  window.location.hash = "#/pin/test-id";
  render(<PinRoute />);

  fireEvent.mouseEnter(await screen.findByTestId("pin-root"));

  const controls = await screen.findByTestId("pin-controls");
  expect(controls.style.top).toBe("24px");
});
```

Update the existing test `"places the pin annotation toolbar outside the image at the lower-left of the pin window"` if needed to assert the toolbar selection's `data-selection-x` remains `24`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test src/__tests__/pin-route.test.tsx`

Expected: FAIL because `pinControlsBaseStyle.top` is currently `PIN_SHADOW_PADDING + TOOLBAR_GAP`.

- [ ] **Step 3: Update Pin controls top offset**

In `Pin.tsx`, change:

```ts
top: PIN_SHADOW_PADDING + TOOLBAR_GAP,
```

to:

```ts
top: PIN_SHADOW_PADDING,
```

Also update `pinControlsStyleForSide` if horizontal offsets need to preserve the existing right-side gap while top aligns exactly.

- [ ] **Step 4: Verify Pin edit toolbar left alignment**

Review `pinToolbarSelection(editorSelection)`:

```ts
function pinToolbarSelection(content: Rect): Rect {
  return {
    ...content,
    x: PIN_SHADOW_PADDING,
    y: PIN_SHADOW_PADDING,
  };
}
```

If it already produces `x = 24`, no implementation change is needed. Keep or strengthen the existing test.

- [ ] **Step 5: Run Pin tests**

Run: `pnpm test src/__tests__/pin-route.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit Chunk 4**

```bash
git add src/routes/Pin.tsx src/__tests__/pin-route.test.tsx
git commit -m "fix: align pin toolbars to content edge"
```

---

## Chunk 5: Integrated Verification

### Task 9: Run focused frontend and backend tests

**Files:**
- No new files.

- [ ] **Step 1: Run focused frontend suites**

Run:

```bash
pnpm test src/__tests__/overlay-route.test.tsx src/__tests__/scroll-chrome.test.tsx src/__tests__/pin-route.test.tsx src/__tests__/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run Rust focused tests**

Run:

```bash
cd src-tauri && cargo test scroll_chrome start_scroll_session_emits_initial_progress_before_capture_loop
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run Rust check**

Run:

```bash
cd src-tauri && cargo check
```

Expected: PASS.

### Task 10: Visual smoke test in the app

**Files:**
- No new files.

- [ ] **Step 1: Start the full app**

Run:

```bash
pnpm tauri dev
```

Expected: app launches.

- [ ] **Step 2: Manually smoke scroll capture**

Use the capture hotkey, select a scrollable page, click the scrolling screenshot tool, and verify:

- scroll panel appears at the selection right-lower side;
- panel flips left-lower near the screen right edge;
- panel shows initial selected preview before scrolling;
- top hint appears briefly inside the selection;
- Check is hidden before scrolling;
- Check appears inside selection bottom after a real scroll;
- clicking Check pins the stitched result.

- [ ] **Step 3: Manually smoke Pin alignment**

Create a pin, hover it, and verify:

- vertical Pin controls top edge aligns with the pinned image content edge;
- in edit mode, the horizontal annotation toolbar left edge aligns to the same edge.

- [ ] **Step 4: Commit any final fixes**

If fixes were required:

```bash
git add <changed-files>
git commit -m "fix: polish scroll pin chrome layout"
```

If no fixes were required, do not create an empty commit.
