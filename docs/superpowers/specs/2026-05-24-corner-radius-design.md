# Configurable Screenshot Corner Radius

**Status:** Approved
**Date:** 2026-05-24
**Branch:** TBD

## Problem

Users want to round the corners of region screenshots before they hit the
clipboard, file system, or a pin window. Today every cropped image is a
rectangle. The feature must be controllable from the screenshot overlay
without leaving the capture session and must persist across sessions so the
preferred radius is the default next time.

## Scope

- **In scope:** Region capture only — the manual-selection flow that opens
  the overlay, screenshot toolbar, and existing IPC commands
  (`crop_and_copy`, `crop_and_save`, `pin_image`).
- **Out of scope:**
  - Fullscreen quick-shot (`copy_active_display_to_clipboard`) — always
    rectangular.
  - Active-window quick-shot (`copy_active_window_to_clipboard`) — always
    rectangular.
  - Scrolling screenshot output — always rectangular (the stitched canvas
    has no clean boundary for rounding).
  - Settings panel UI for the radius — adjustments through the overlay
    slider persist automatically, no second control surface needed.

## User-facing design

A new round-corner button sits at the top of the vertical screenshot
toolbar (immediately below the drag handle, above the existing Pin button).
Clicking it opens a small horizontal panel anchored to the toolbar's left
side. The panel contains a single horizontal slider (range 0–60 px,
step 1) plus a numeric readout `N px`. Dragging the slider applies the
radius live to the selection: the dim mask hole and the selection outline
both follow the rounded path. Releasing the mouse persists the value to
`settings.json`. Clicking outside the panel closes it; clicking the button
again toggles it.

The button icon is a custom inline SVG: a rounded-corner square whose
`rx` attribute scales with the current radius value, giving a glanceable
hint of "how round" the next capture will be.

## Architecture

### Data flow

```
┌──────────────────────────────┐
│ settings.json                │
│   cornerRadius: u32 (0..=60) │
└─────────────┬────────────────┘
              │ load
              ▼
┌──────────────────────────────┐         ┌──────────────────────────┐
│ Rust: capture session start  │ event   │ Frontend: overlay store  │
│   include cornerRadius in    ├────────▶│   cornerRadius: number   │
│   capture:start payload      │         │   setCornerRadius(n)     │
└──────────────────────────────┘         └────────────┬─────────────┘
                                                      │
                                  ┌───────────────────┤
                                  ▼                   ▼
                          ┌───────────────┐  ┌────────────────────────┐
                          │ live preview  │  │ debounce 150ms         │
                          │ SelectionBox  │  │   ─▶ setSettings(...)  │
                          │ DimMask       │  └────────────────────────┘
                          └───────────────┘
                                  │
                                  │ user clicks Copy/Save/Pin
                                  ▼
                          ┌──────────────────────────────────────┐
                          │ IPC: crop_and_copy(... cornerRadius) │
                          │ IPC: crop_and_save(... cornerRadius) │
                          │ IPC: pin_image    (... cornerRadius) │
                          └────────────┬─────────────────────────┘
                                       ▼
                          ┌──────────────────────────────┐
                          │ Rust: crop_rgba              │
                          │   ─▶ composite_annotation    │
                          │   ─▶ mask::apply_rounded_    │
                          │       corners                │
                          │   ─▶ clipboard / saver / pin │
                          └──────────────────────────────┘
```

The frontend always passes the live `cornerRadius` from the store with the
IPC call. Settings persistence is debounced and used only as the *default*
when the next overlay session opens — never as the source of truth during
an active session. This avoids races where a slider drag has not yet
flushed to disk when the user clicks Copy.

### Backend

**`src-tauri/src/settings_store.rs`**: add field

```rust
#[serde(default)]
pub corner_radius: u32,
```

Default value `0`. Range is enforced by the frontend slider; the backend
defensively clamps to `[0, 60]` when reading user input.

**`src-tauri/src/mask.rs`** (new file):

```rust
pub fn apply_rounded_corners(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    radius_logical: u32,
    scale_factor: f32,
);
```

Behaviour:

1. Clamp `radius_logical` to `min(width, height) / 2 / scale_factor` so the
   mask never crosses the centerline.
2. Convert to physical radius `r = round(radius_logical * scale_factor)`.
3. If `r == 0`, return immediately (zero-cost path).
4. For each of the four corner squares (size `r × r`), iterate pixels and
   compute the distance from the corner-circle center. Use 2×2
   oversampling for the boundary band (`|d - r| < 1.5`) so the mask is
   anti-aliased without expensive whole-image supersampling.
5. Multiply the existing alpha channel by the mask coverage (so partially
   transparent input pixels stay partially transparent).

Performance budget: 60 × 60 × 4 = 14 400 boundary pixels with 4× sampling
≈ 60 000 sub-samples. Far under the existing 8 ms crop budget. No
allocation; mutates the RGBA buffer in place.

**`src-tauri/src/commands.rs`**:

- Add `corner_radius: u32` parameter to `crop_and_copy`, `crop_and_save`,
  `pin_image`.
- After `crop_rgba` and (if present) `composite_annotation`, call
  `mask::apply_rounded_corners(...)` on the resulting buffer.

**`src-tauri/src/lib.rs`** (capture session):

- When emitting the `capture:start` event, read the current settings and
  include `cornerRadius` in the payload.

### Frontend

**`src/overlay/state.ts`**:

```ts
interface OverlayState {
  // ... existing
  cornerRadius: number;
  setCornerRadius: (n: number) => void;
}
```

`start(payload)` initialises `cornerRadius` from the payload (falls back
to 0 if absent for older Rust builds during development). `setCornerRadius`
clamps to `[0, 60]`, updates the store synchronously, and schedules a
debounced `setSettings({ ...current, cornerRadius })`.

Scrolling capture forces `cornerRadius` to `0` for rendering purposes — the
store value is unchanged, but the preview components read it via a derived
selector that returns `0` when `mode === "scrollStarting" || mode ===
"scrolling"`.

**`src/lib/ipc.ts`**: extend the three command wrappers with the
`cornerRadius` argument.

**`src/overlay/Toolbar.tsx`**:

- Insert a new `ToolbarGroup name="radius"` immediately under the drag
  handle (before the existing `pin-scroll` group). Add a `<Separator />`
  below the new group to keep the visual cadence.
- The group contains a single `ToolbarButton` whose icon is a custom inline
  SVG rendering a rounded-corner square with `rx = scaleIconRx(radius)`.
- Clicking the button toggles a `CornerRadiusPanel` component (similar to
  `PropertyPanel` from the annotation toolbar).

**`src/overlay/CornerRadiusPanel.tsx`** (new file):

- Receives anchor rect (the toolbar button's bounding box) and the
  current/setter pair.
- Renders a horizontal `<input type="range" min={0} max={60} step={1}>`
  styled with the existing dark-theme CSS variables, plus a `N px` label.
- Anchors to the **left** of the vertical toolbar (when there is room) or
  **above** as a fallback, matching the existing `PropertyPanel.tsx`
  fallback geometry pattern.
- Uses `useDismissOnOutsideMouseDown` (refactor / re-export from
  `PropertyPanel.tsx` so both panels share one implementation) to close on
  outside clicks. Escape key does **not** close the panel — Escape already
  cancels the capture session.

**`src/overlay/SelectionBox.tsx`**:

- Replace the rectangular `outline` div with an absolute-positioned SVG
  that renders a single `<rect>` with `stroke`, `fill="none"`, and `rx`/
  `ry` set to the live `cornerRadius`.
- Keep the existing comment about "do not paint inside the rect during
  scrolling" — the derived selector that zeroes out `cornerRadius` during
  scrolling already takes care of this.

**`src/overlay/DimMask.tsx`**:

- Replace the four-rect approach with a single SVG that uses an SVG
  `<mask>` to cut a rounded rect out of the monitor-wide dim layer.

**`src/overlay/FrozenLayer.tsx`** and **`src/annotation/Stage.tsx`**:

- No changes. Annotations remain free to draw outside the rounded shape
  during the live session; the backend applies the alpha mask after
  compositing so annotations are clipped uniformly with the base image on
  export.

**`src/routes/Pin.tsx`** and pin window URL:

- CSS `box-shadow` does not follow image alpha — a rounded PNG with a
  rectangular `<img>` element still has a rectangular shadow. To keep the
  pin window's glow following the rounded shape, pass the radius through
  the pin route URL (`index.html#/pin/{id}?annotation=1&radius=8`) and
  apply `borderRadius: ${radius}px` to the `<img>` element. The annotation
  layer image needs the same `borderRadius` so it does not overhang the
  base.
- `commands.rs:pin_image` already accepts a `corner_radius` parameter for
  the mask; it must additionally append `&radius={n}` to the route URL
  when `n > 0`.

## Annotations and the corner cut-out

Annotations are not clipped during preview. If a user draws inside a
corner that the mask will eventually erase, they will see it intact in the
overlay but transparent in the output. This is a deliberate trade-off:

- Pro: keeps `FrozenLayer` / `AnnotationStage` simple — no clip-path or
  mask composition in the live canvas.
- Pro: the same mask logic in `mask::apply_rounded_corners` covers both
  base pixels and annotation pixels, so the output is always internally
  consistent.
- Con: the rounded preview does not warn the user that a corner annotation
  will be cropped.

The user has signed off on this trade-off. A future iteration could add a
faint guide outline on the live canvas without changing the export path.

## Persistence model

- Source of truth during an active capture: the overlay Zustand store.
- Persisted default for next capture: `settings.json:cornerRadius`.
- Slider drags write to the store immediately and to `settings.json` on a
  150 ms trailing debounce.
- If the user cancels the capture (Escape / right-click / close button),
  the most recent debounced write still completes — the choice is "sticky"
  even when the screenshot itself is discarded. This matches what users
  expect from a persistent UI control.

## File format and JPEG concern

The save dialog (`src-tauri/src/saver.rs`) already restricts to PNG only
(`add_filter("PNG Image", &["png"])`). Rounded corners produce transparent
edges, which PNG handles natively. No format-handling changes are needed.

## Testing

### Rust unit tests (`src-tauri/src/mask.rs`)

1. `apply_rounded_corners_zero_radius_is_noop` — buffer unchanged.
2. `apply_rounded_corners_clears_corner_alpha_to_zero` — radius=8 on a
   solid opaque buffer leaves pixels at (0, 0) / (w-1, 0) / etc. with
   alpha 0.
3. `apply_rounded_corners_preserves_center_pixels` — center pixel alpha
   and RGB unchanged.
4. `apply_rounded_corners_anti_aliases_boundary` — at least one pixel in
   the boundary band has an alpha value strictly between 0 and 255.
5. `apply_rounded_corners_clamps_radius_to_half_min_dimension` — passing
   radius = width gives the same output as radius = width/2.
6. `apply_rounded_corners_scales_by_scale_factor` — physical mask radius
   doubles when scale_factor = 2.

### Rust integration tests (`src-tauri/src/commands.rs`)

7. `crop_and_copy_applies_corner_radius_to_output` — call sequence
   includes `mask::apply_rounded_corners` after `crop_rgba` and
   `composite_annotation`.
8. `quick_shot_paths_do_not_apply_corner_radius` — source-level assertion
   that `copy_active_display_to_clipboard` and
   `copy_active_window_to_clipboard` never reference `apply_rounded_corners`.

### Frontend tests (Vitest)

9. `corner-radius-store.test.ts` — `setCornerRadius(n)` updates store
   immediately and schedules debounced settings write; rapid updates
   coalesce into a single write.
10. `corner-radius-panel.test.tsx` — clicking the toolbar button toggles
    the panel; slider input updates the store; outside click dismisses.
11. `selection-box-rounded.test.tsx` — `cornerRadius=12` renders an SVG
    `<rect>` with `rx="12"`; `mode="scrolling"` forces `rx="0"` regardless
    of store value.
12. `dim-mask-rounded.test.tsx` — `cornerRadius=12` renders an SVG mask
    whose hole rect has `rx="12"`.
13. `ipc.test.ts` — the three command wrappers forward `cornerRadius` to
    `invoke`.

### Manual verification (must do)

- Launch dev build, capture a region, drag the slider 0 → 30 → 0 and
  confirm preview updates smoothly without jank.
- Copy, then paste into an image editor — corners are transparent.
- Save to file, open the resulting PNG — corners are transparent.
- Pin a rounded region — both the image and the surrounding glow follow
  the rounded outline; nothing bleeds past `PIN_SHADOW_PADDING`.
- Restart the app — the last-used radius is loaded as the default.
- Trigger a fullscreen quick-shot hotkey — output is rectangular even
  when `cornerRadius > 0` in settings.
- Trigger an active-window quick-shot hotkey — same, rectangular output.

## Implementation order

1. Backend: add `cornerRadius` to `Settings`, create `mask.rs` with unit
   tests, wire into the three commands, include in `capture:start` payload.
2. Frontend store: add field + setter + debounced persistence.
3. Frontend toolbar: insert the button + panel; reuse the dismiss hook.
4. Frontend preview: convert `SelectionBox` and `DimMask` to SVG.
5. End-to-end manual verification on macOS.
6. Conventional commits along the way; one PR at the end.

## Risks

- **Pin window shadow alignment.** Pin windows already pad by
  `PIN_SHADOW_PADDING` (24 px) for the CSS glow. CSS `box-shadow` is
  rectangular by default and does not follow image alpha, so a rounded
  PNG would still cast a square shadow. Mitigation is the `?radius=N`
  URL param plus `borderRadius` on the `<img>` (see the Pin route
  section above). Verify visually on retina that the glow follows the
  rounded outline.
- **SVG mask performance.** Multi-monitor setups with very large dim
  layers might paint slower than four-div rects. If it shows up as jank
  during drag, fall back to four absolutely-positioned div tiles plus
  four small corner-fill SVGs.
- **Slider on overlay window focus.** The vertical toolbar already takes
  `onMouseDown` and `stopPropagation` to keep clicks from canceling the
  capture. The panel must propagate the same guard or it will dismiss
  the capture on first click.
