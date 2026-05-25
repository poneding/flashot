# Configurable Screenshot Corner Radius Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users round the corners of region screenshots from a slider in the screenshot toolbar, with live preview, persisted as the default for next session, applied to Copy / Save / Pin output.

**Architecture:**
- Backend: new `mask::apply_rounded_corners` mutates the RGBA buffer in place after `crop_rgba` + `composite_annotation`; three IPC commands gain a `cornerRadius: u32` parameter; quick-shot paths are untouched.
- Frontend: Zustand store carries the live `cornerRadius`, hydrated from settings on capture start, written back with a debounced `setSettings`; preview is driven by SVG (rounded `<rect>` outline + SVG `<mask>` cutout).
- Pin window: `?radius=N` URL param + `border-radius` on the `<img>` so the CSS glow follows the rounded shape.

**Tech Stack:** Tauri 2, Rust (image, anyhow), React 18 + TypeScript, Zustand, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-24-corner-radius-design.md`

---

## File Structure

**New files**
- `src-tauri/src/mask.rs` — alpha-mask routine + unit tests
- `src/lib/useDismissOnOutsideMouseDown.ts` — extracted hook for popovers
- `src/overlay/CornerRadiusPanel.tsx` — slider popover
- `src/__tests__/corner-radius-store.test.ts`
- `src/__tests__/corner-radius-panel.test.tsx`
- `src/__tests__/selection-box-rounded.test.tsx`
- `src/__tests__/dim-mask-rounded.test.tsx`

**Modified files**
- `src-tauri/src/settings_store.rs` — `corner_radius` field
- `src-tauri/src/commands.rs` — three commands accept and apply the radius
- `src-tauri/src/lib.rs` — register `mask` module, include `cornerRadius` in `capture:start`
- `src/lib/types.ts` — `Settings.cornerRadius`, `CaptureStartPayload.cornerRadius`
- `src/lib/ipc.ts` — three wrappers forward `cornerRadius`
- `src/overlay/state.ts` — store field + setter + debounced persistence
- `src/routes/Overlay.tsx` — pass `cornerRadius` into `cropAndCopy/Save` and `pinImage`
- `src/overlay/Toolbar.tsx` — new first button, panel state
- `src/overlay/SelectionBox.tsx` — SVG outline with `rx`
- `src/overlay/DimMask.tsx` — SVG mask with rounded hole
- `src/routes/Pin.tsx` — read `radius` query param, apply `border-radius`
- `src/annotation/PropertyPanel.tsx` — import shared dismiss hook

---

## Task 1: Add `corner_radius` to Settings struct

**Files:**
- Modify: `src-tauri/src/settings_store.rs`

- [ ] **Step 1: Add failing test for default + roundtrip**

Append the following test inside the `tests` module of `src-tauri/src/settings_store.rs`, just before the closing `}` of `mod tests`:

```rust
#[test]
fn default_settings_have_zero_corner_radius() {
    let settings = Settings::default();
    assert_eq!(settings.corner_radius, 0);
}

#[test]
fn settings_round_trip_corner_radius() {
    let json = r#"{"cornerRadius":16}"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.corner_radius, 16);
    let value = serde_json::to_value(settings).unwrap();
    assert_eq!(value["cornerRadius"], 16);
}

#[test]
fn legacy_settings_without_corner_radius_default_to_zero() {
    let settings: Settings = serde_json::from_str(r#"{}"#).unwrap();
    assert_eq!(settings.corner_radius, 0);
}
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd src-tauri && cargo test settings_store::tests::default_settings_have_zero_corner_radius settings_store::tests::settings_round_trip_corner_radius settings_store::tests::legacy_settings_without_corner_radius_default_to_zero --no-fail-fast
```

Expected: compile error / missing field `corner_radius`.

- [ ] **Step 3: Add the field**

Edit `src-tauri/src/settings_store.rs`. Insert the new field at the bottom of the `Settings` struct (before the closing `}`):

```rust
    #[serde(default)]
    pub corner_radius: u32,
```

Add to the `Default` impl, before the closing `}`:

```rust
            corner_radius: 0,
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd src-tauri && cargo test settings_store --no-fail-fast
```

Expected: every `settings_store::tests::*` test passes, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings_store.rs
git commit -m "feat(settings): add cornerRadius field"
```

---

## Task 2: Create `mask.rs` with `apply_rounded_corners`

**Files:**
- Create: `src-tauri/src/mask.rs`
- Modify: `src-tauri/src/lib.rs` (register the module)

- [ ] **Step 1: Create the module file with failing tests**

Create `src-tauri/src/mask.rs`:

```rust
/// Multiply the alpha channel of a straight-alpha RGBA buffer by a
/// rounded-rectangle coverage mask. Mutates `rgba` in place.
///
/// `radius_logical` is in logical (CSS) pixels. The mask radius in physical
/// pixels is `radius_logical * scale_factor`, clamped so neither axis
/// crosses the centerline. The four corner squares are processed with 2x2
/// supersampling for an anti-aliased boundary; the rest of the buffer is
/// untouched.
pub fn apply_rounded_corners(
    rgba: &mut [u8],
    width: u32,
    height: u32,
    radius_logical: u32,
    scale_factor: f32,
) {
    if radius_logical == 0 || width == 0 || height == 0 {
        return;
    }
    debug_assert_eq!(rgba.len(), (width as usize) * (height as usize) * 4);

    let scale = scale_factor.max(1.0);
    let max_radius = (width.min(height) as f32) / 2.0;
    let radius = (radius_logical as f32 * scale).min(max_radius);
    if radius < 0.5 {
        return;
    }

    let r_ceil = radius.ceil() as u32;
    let r_squared = radius * radius;

    let corners: [(f32, f32, u32, u32); 4] = [
        (radius, radius, 0, 0),
        (width as f32 - radius, radius, width - r_ceil, 0),
        (radius, height as f32 - radius, 0, height - r_ceil),
        (
            width as f32 - radius,
            height as f32 - radius,
            width - r_ceil,
            height - r_ceil,
        ),
    ];

    for (cx, cy, ox, oy) in corners {
        for py in 0..r_ceil {
            for px in 0..r_ceil {
                let x = ox + px;
                let y = oy + py;
                if x >= width || y >= height {
                    continue;
                }
                let coverage = corner_coverage(
                    x as f32 + 0.5,
                    y as f32 + 0.5,
                    cx,
                    cy,
                    radius,
                    r_squared,
                );
                if coverage >= 0.999 {
                    continue;
                }
                let idx = ((y * width + x) * 4 + 3) as usize;
                let current = rgba[idx] as f32;
                rgba[idx] = (current * coverage).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

fn corner_coverage(x: f32, y: f32, cx: f32, cy: f32, r: f32, r_squared: f32) -> f32 {
    let dx = x - cx;
    let dy = y - cy;
    let d_sq = dx * dx + dy * dy;

    // Subpixel diagonal radius for boundary band detection.
    const BAND: f32 = 0.7071068;

    if d_sq <= (r - BAND) * (r - BAND).max(0.0) {
        return 1.0;
    }
    if d_sq >= (r + BAND) * (r + BAND) {
        return 0.0;
    }

    let mut hits = 0.0_f32;
    for sy in 0..2 {
        for sx in 0..2 {
            let sx_f = x - 0.25 + sx as f32 * 0.5;
            let sy_f = y - 0.25 + sy as f32 * 0.5;
            let d2 = (sx_f - cx).powi(2) + (sy_f - cy).powi(2);
            if d2 <= r_squared {
                hits += 1.0;
            }
        }
    }
    hits / 4.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opaque_white(width: u32, height: u32) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            v.extend_from_slice(&[255, 255, 255, 255]);
        }
        v
    }

    fn alpha_at(rgba: &[u8], width: u32, x: u32, y: u32) -> u8 {
        rgba[((y * width + x) * 4 + 3) as usize]
    }

    #[test]
    fn apply_rounded_corners_zero_radius_is_noop() {
        let mut rgba = opaque_white(10, 10);
        let before = rgba.clone();
        apply_rounded_corners(&mut rgba, 10, 10, 0, 1.0);
        assert_eq!(rgba, before);
    }

    #[test]
    fn apply_rounded_corners_clears_corner_alpha_to_zero() {
        let mut rgba = opaque_white(20, 20);
        apply_rounded_corners(&mut rgba, 20, 20, 8, 1.0);
        assert_eq!(alpha_at(&rgba, 20, 0, 0), 0, "top-left corner");
        assert_eq!(alpha_at(&rgba, 20, 19, 0), 0, "top-right corner");
        assert_eq!(alpha_at(&rgba, 20, 0, 19), 0, "bottom-left corner");
        assert_eq!(alpha_at(&rgba, 20, 19, 19), 0, "bottom-right corner");
    }

    #[test]
    fn apply_rounded_corners_preserves_center_pixels() {
        let mut rgba = opaque_white(20, 20);
        apply_rounded_corners(&mut rgba, 20, 20, 8, 1.0);
        assert_eq!(alpha_at(&rgba, 20, 10, 10), 255);
        assert_eq!(alpha_at(&rgba, 20, 5, 10), 255);
        assert_eq!(alpha_at(&rgba, 20, 10, 5), 255);
        // RGB untouched
        let idx = ((10 * 20 + 10) * 4) as usize;
        assert_eq!(&rgba[idx..idx + 3], &[255, 255, 255]);
    }

    #[test]
    fn apply_rounded_corners_anti_aliases_boundary() {
        let mut rgba = opaque_white(40, 40);
        apply_rounded_corners(&mut rgba, 40, 40, 12, 1.0);
        let mut partial_count = 0;
        for y in 0..12 {
            for x in 0..12 {
                let a = alpha_at(&rgba, 40, x, y);
                if a > 0 && a < 255 {
                    partial_count += 1;
                }
            }
        }
        assert!(
            partial_count > 0,
            "expected anti-aliased pixels on the boundary, found none",
        );
    }

    #[test]
    fn apply_rounded_corners_clamps_oversized_radius_to_half_min_dimension() {
        let mut a = opaque_white(20, 30);
        let mut b = opaque_white(20, 30);
        apply_rounded_corners(&mut a, 20, 30, 999, 1.0);
        apply_rounded_corners(&mut b, 20, 30, 10, 1.0);
        assert_eq!(a, b, "oversized radius should clamp to min(w,h)/2 = 10");
    }

    #[test]
    fn apply_rounded_corners_scales_with_scale_factor() {
        // At scale 2, radius_logical=4 should mask the same physical pixels
        // as radius_logical=8 at scale 1.
        let mut a = opaque_white(40, 40);
        let mut b = opaque_white(40, 40);
        apply_rounded_corners(&mut a, 40, 40, 4, 2.0);
        apply_rounded_corners(&mut b, 40, 40, 8, 1.0);
        assert_eq!(a, b);
    }

    #[test]
    fn apply_rounded_corners_respects_existing_alpha() {
        // Half-transparent input should end up at half * coverage.
        let mut rgba: Vec<u8> = (0..(20 * 20))
            .flat_map(|_| [200u8, 100, 50, 128])
            .collect();
        apply_rounded_corners(&mut rgba, 20, 20, 8, 1.0);
        assert_eq!(alpha_at(&rgba, 20, 0, 0), 0, "outside corner: 128 * 0 = 0");
        assert_eq!(alpha_at(&rgba, 20, 10, 10), 128, "center: 128 * 1 = 128");
    }
}
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/lib.rs`. Find the existing `mod` declarations near the top of the file (search for `mod commands;`) and add `mod mask;` alongside them in alphabetical order:

```rust
mod mask;
```

- [ ] **Step 3: Run the new tests and confirm they pass**

```bash
cd src-tauri && cargo test mask::tests --no-fail-fast
```

Expected: 7 passing tests.

- [ ] **Step 4: Run clippy on the new module**

```bash
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mask.rs src-tauri/src/lib.rs
git commit -m "feat(mask): add apply_rounded_corners alpha mask"
```

---

## Task 3: Apply mask in `crop_and_copy`, `crop_and_save`, `pin_image`

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add failing test for the call ordering**

Append to the `tests` module in `src-tauri/src/commands.rs`, just before the closing `}` of `mod tests`:

```rust
#[test]
fn crop_commands_apply_corner_radius_after_compositing() {
    let source = include_str!("commands.rs").replace("\r\n", "\n");
    for name in ["crop_and_copy", "crop_and_save", "pin_image"] {
        let body = function_body(&source, name);
        let composite_idx = body.find("composite_annotation").unwrap_or(0);
        let mask_idx = body
            .find("apply_rounded_corners")
            .unwrap_or_else(|| panic!("{name} must call mask::apply_rounded_corners"));
        assert!(
            composite_idx < mask_idx,
            "{name}: mask must be applied after compositing annotations",
        );
        assert!(
            body.contains("corner_radius"),
            "{name} must accept a corner_radius parameter",
        );
    }
}

#[test]
fn quick_shot_paths_do_not_apply_corner_radius() {
    let source = include_str!("lib.rs").replace("\r\n", "\n");
    for name in [
        "copy_active_display_to_clipboard",
        "copy_active_window_to_clipboard",
    ] {
        let body = function_body(&source, name);
        assert!(
            !body.contains("apply_rounded_corners"),
            "{name}: fullscreen and active-window quick-shots must stay rectangular",
        );
    }
}
```

- [ ] **Step 2: Run the new tests and confirm they fail**

```bash
cd src-tauri && cargo test commands::tests::crop_commands_apply_corner_radius_after_compositing commands::tests::quick_shot_paths_do_not_apply_corner_radius --no-fail-fast
```

Expected: `crop_commands_apply_corner_radius_after_compositing` fails ("function_body did not find..." or assertion). `quick_shot_paths_do_not_apply_corner_radius` passes already (no calls exist yet).

The second test reads `lib.rs`, which `commands.rs` cannot `include_str!` directly. Adjust the test to use a path:

```rust
#[test]
fn quick_shot_paths_do_not_apply_corner_radius() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
    )
    .unwrap()
    .replace("\r\n", "\n");
    for name in [
        "copy_active_display_to_clipboard",
        "copy_active_window_to_clipboard",
    ] {
        let body = function_body(&source, name);
        assert!(
            !body.contains("apply_rounded_corners"),
            "{name}: fullscreen and active-window quick-shots must stay rectangular",
        );
    }
}
```

Re-run, confirm only the first test fails.

- [ ] **Step 3: Add `corner_radius` parameter and mask call to the three commands**

Edit `src-tauri/src/commands.rs`.

In `crop_and_copy`, change the signature and call sequence. Find this block:

```rust
#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    let final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    clipboard::copy_image(final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())?;
    mgr.end_session(&app);
    Ok(())
}
```

Replace with:

```rust
#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    corner_radius: u32,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;
    let mut final_image = match annotation_png {
        Some(png_data) if !png_data.is_empty() => composite_annotation(&cropped, &png_data)?,
        _ => cropped,
    };
    crate::mask::apply_rounded_corners(
        &mut final_image.rgba,
        final_image.width,
        final_image.height,
        corner_radius,
        frame.scale_factor,
    );
    clipboard::copy_image(final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())?;
    mgr.end_session(&app);
    Ok(())
}
```

Apply the same pattern to `crop_and_save` (insert `corner_radius: u32` after `annotation_png: Option<Vec<u8>>,`, change `let final_image =` to `let mut final_image =`, and call `crate::mask::apply_rounded_corners(...)` immediately after the match).

Apply the same pattern to `pin_image` (insert `corner_radius: u32` after `annotation_png: Option<Vec<u8>>,`, change `let cropped =` to `let mut cropped =`, and after the existing `let annotation_path = match annotation_png { ... };` block but BEFORE the `save_pin_png` call, add):

```rust
crate::mask::apply_rounded_corners(
    &mut cropped.rgba,
    cropped.width,
    cropped.height,
    corner_radius,
    frame.scale_factor,
);
```

Move the mask call to immediately after the `save_pin_png(&cropped.rgba, ...)` site if reordering breaks other behaviour. The mask must apply to the pin window's PNG, which is what `save_pin_png` writes.

Read the surrounding code carefully — the existing pin-image flow writes the *base* PNG and a *separate* annotation PNG. The mask must apply to the base PNG (the one written by `save_pin_png`). Do not apply the mask to the annotation PNG — the pin window will clip both via CSS `border-radius` (see Task 14).

Concretely, replace the `save_pin_png(&cropped.rgba, ...)` line in `pin_image` with a small two-step:

```rust
crate::mask::apply_rounded_corners(
    &mut cropped.rgba,
    cropped.width,
    cropped.height,
    corner_radius,
    frame.scale_factor,
);
save_pin_png(&cropped.rgba, cropped.width, cropped.height, &image_path)?;
```

- [ ] **Step 4: Run the call-ordering test and confirm it passes**

```bash
cd src-tauri && cargo test commands::tests::crop_commands_apply_corner_radius_after_compositing --no-fail-fast
```

Expected: pass.

- [ ] **Step 5: Run the rest of the commands tests**

```bash
cd src-tauri && cargo test commands::tests --no-fail-fast
```

Expected: every commands::tests::* test passes. The existing `crop_and_save_ends_capture_before_opening_save_dialog`, `pin_image_*` etc. tests rely on source-level matching — they should still pass since the call sequence is preserved.

- [ ] **Step 6: Run clippy**

```bash
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

Expected: no warnings. If clippy complains about `mut` on `cropped` in `pin_image` only being needed for the new mask call, that is the correct shape — keep it.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): apply corner radius mask after annotation composite"
```

---

## Task 4: Append `?radius=N` to pin window URL

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add failing test for URL formation**

Append to the `tests` module in `src-tauri/src/commands.rs`:

```rust
#[test]
fn pin_image_appends_radius_to_route_when_nonzero() {
    let source = include_str!("commands.rs").replace("\r\n", "\n");
    let body = function_body(&source, "pin_image");
    assert!(
        body.contains("&radius="),
        "pin_image must forward corner_radius to the pin route URL when > 0",
    );
    assert!(
        body.contains("if corner_radius > 0"),
        "pin_image must only append the radius query param when nonzero",
    );
}
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd src-tauri && cargo test commands::tests::pin_image_appends_radius_to_route_when_nonzero --no-fail-fast
```

Expected: fail.

- [ ] **Step 3: Build the URL conditionally**

In `src-tauri/src/commands.rs`, locate this block inside `pin_image`:

```rust
    let window_label = format!("pin-{}", pin_id);
    let route = if annotation_path.is_some() {
        format!("index.html#/pin/{}?annotation=1", pin_id)
    } else {
        format!("index.html#/pin/{}", pin_id)
    };
    let url = tauri::WebviewUrl::App(route.into());
```

Replace with:

```rust
    let window_label = format!("pin-{}", pin_id);
    let mut route = if annotation_path.is_some() {
        format!("index.html#/pin/{}?annotation=1", pin_id)
    } else {
        format!("index.html#/pin/{}", pin_id)
    };
    if corner_radius > 0 {
        let separator = if route.contains('?') { "&" } else { "?" };
        route.push_str(&format!("{separator}radius={corner_radius}"));
    }
    let url = tauri::WebviewUrl::App(route.into());
```

- [ ] **Step 4: Run the URL test and the existing pin tests**

```bash
cd src-tauri && cargo test commands::tests::pin_image --no-fail-fast
```

Expected: all `pin_image_*` tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(pin): forward corner radius to pin route URL"
```

---

## Task 5: Include `cornerRadius` in `capture:start` payload

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing test**

Append to the `tests` module at the bottom of `src-tauri/src/lib.rs` (next to the existing `quick_shot_*` tests):

```rust
#[test]
fn capture_start_payload_includes_corner_radius() {
    let source = include_str!("lib.rs").replace("\r\n", "\n");
    let start = source.find("struct CaptureStartPayload").unwrap();
    let end = source[start..].find("}\n").map(|idx| start + idx).unwrap();
    let body = &source[start..end];
    assert!(
        body.contains("corner_radius"),
        "CaptureStartPayload must carry the persisted corner radius to the frontend",
    );
    assert!(
        body.contains("cornerRadius"),
        "CaptureStartPayload must serialize as camelCase cornerRadius",
    );
}
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd src-tauri && cargo test capture_start_payload_includes_corner_radius --no-fail-fast
```

Expected: fail.

- [ ] **Step 3: Extend the struct**

Edit `src-tauri/src/lib.rs`. Find the `CaptureStartPayload` struct and add a field before the closing `}`:

```rust
    #[serde(rename = "cornerRadius")]
    corner_radius: u32,
```

- [ ] **Step 4: Populate the field at emission**

Find the `app.emit_to(...)` block that constructs `CaptureStartPayload`. Just above the construction, load the persisted radius:

```rust
            let corner_radius = settings_store::load()
                .map(|s| s.corner_radius.min(60))
                .unwrap_or(0);
```

Insert this `let corner_radius = ...` line immediately before `tracing::info!("run_capture: emitting capture:start event");`.

Then update the struct construction to include the new field:

```rust
                CaptureStartPayload {
                    monitor_id: mon.id,
                    frame_url: asset_url,
                    monitor_rect: mon.rect,
                    scale_factor: mon.scale_factor,
                    windows: local_windows,
                    corner_radius,
                },
```

- [ ] **Step 5: Run the test and confirm it passes**

```bash
cd src-tauri && cargo test capture_start_payload_includes_corner_radius --no-fail-fast
```

Expected: pass.

- [ ] **Step 6: Run the full backend suite + clippy**

```bash
cd src-tauri && cargo test --no-fail-fast && cargo clippy --all-targets -- -D warnings
```

Expected: all pass, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(capture): broadcast persisted corner radius on capture:start"
```

---

## Task 6: Extend frontend type definitions

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add field to `Settings`**

In `src/lib/types.ts`, add `cornerRadius` to the `Settings` type:

```ts
export type Settings = {
  captureHotkey: string;
  fullscreenHotkey: string;
  activeWindowHotkey: string;
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  lastSaveDir: string | null;
  cornerRadius: number;
};
```

- [ ] **Step 2: Add field to `CaptureStartPayload`**

Below `Settings`, update `CaptureStartPayload`:

```ts
export type CaptureStartPayload = {
  monitorId: number;
  frameUrl: string;
  monitorRect: Rect;
  scaleFactor: number;
  windows: WindowRect[];
  cornerRadius: number;
};
```

- [ ] **Step 3: Run type check**

```bash
pnpm lint
```

Expected: TypeScript errors in callers that don't yet pass `cornerRadius` (e.g. settings tests creating fake `Settings` objects). Fix any test fixtures by adding `cornerRadius: 0` to existing `Settings` literals. Search for them:

```bash
grep -rn "captureHotkey:" src/__tests__/ src/settings/
```

For each match that constructs a full `Settings` object, add `cornerRadius: 0`. For frontend tests that construct `CaptureStartPayload`, add `cornerRadius: 0` too.

Re-run `pnpm lint` until it is clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/__tests__ src/settings
git commit -m "feat(types): add cornerRadius to Settings and CaptureStartPayload"
```

---

## Task 7: Add `cornerRadius` to overlay store with debounced persistence

**Files:**
- Modify: `src/overlay/state.ts`
- Create: `src/__tests__/corner-radius-store.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/corner-radius-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useOverlay } from "@/overlay/state";

vi.mock("@/lib/ipc", () => ({
  setSettings: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({
    captureHotkey: "",
    fullscreenHotkey: "",
    activeWindowHotkey: "",
    theme: "system",
    launchAtLogin: false,
    lastSaveDir: null,
    cornerRadius: 0,
  }),
}));

import { setSettings, getSettings } from "@/lib/ipc";

describe("overlay store corner radius", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useOverlay.setState({ cornerRadius: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("setCornerRadius updates the store immediately", () => {
    useOverlay.getState().setCornerRadius(12);
    expect(useOverlay.getState().cornerRadius).toBe(12);
  });

  it("clamps values outside the 0..60 range", () => {
    useOverlay.getState().setCornerRadius(-5);
    expect(useOverlay.getState().cornerRadius).toBe(0);
    useOverlay.getState().setCornerRadius(100);
    expect(useOverlay.getState().cornerRadius).toBe(60);
  });

  it("coalesces rapid changes into a single debounced setSettings call", async () => {
    (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      captureHotkey: "",
      fullscreenHotkey: "",
      activeWindowHotkey: "",
      theme: "system" as const,
      launchAtLogin: false,
      lastSaveDir: null,
      cornerRadius: 0,
    });

    useOverlay.getState().setCornerRadius(4);
    useOverlay.getState().setCornerRadius(8);
    useOverlay.getState().setCornerRadius(16);

    expect(setSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(160);
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ cornerRadius: 16 }),
    );
  });

  it("start() hydrates cornerRadius from the capture payload", () => {
    useOverlay.getState().start({
      monitorId: 0,
      monitorRect: { x: 0, y: 0, width: 100, height: 100 },
      scaleFactor: 1,
      frameUrl: "",
      windows: [],
      cornerRadius: 20,
    });
    expect(useOverlay.getState().cornerRadius).toBe(20);
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- corner-radius-store
```

Expected: 4 failing tests (`setCornerRadius is not a function` etc.).

- [ ] **Step 3: Add the field, setter, and debounced persistence**

Edit `src/overlay/state.ts`. At the top of the file, after the existing imports, add:

```ts
import { getSettings, setSettings } from "@/lib/ipc";
```

Inside the `State` type, add:

```ts
  cornerRadius: number;
```

Inside the `Actions` type, add:

```ts
  setCornerRadius: (n: number) => void;
```

In the `create<State & Actions>` initial state, add:

```ts
  cornerRadius: 0,
```

Add a module-level debounce helper just above `export const useOverlay`:

```ts
let cornerRadiusPersistTimer: ReturnType<typeof setTimeout> | null = null;

function persistCornerRadiusDebounced(next: number) {
  if (cornerRadiusPersistTimer != null) clearTimeout(cornerRadiusPersistTimer);
  cornerRadiusPersistTimer = setTimeout(() => {
    cornerRadiusPersistTimer = null;
    void getSettings()
      .then((s) => setSettings({ ...s, cornerRadius: next }))
      .catch((err) => console.warn("Failed to persist cornerRadius", err));
  }, 150);
}
```

In the action implementations, add:

```ts
  setCornerRadius: (n) => {
    const clamped = Math.max(0, Math.min(60, Math.round(n)));
    set({ cornerRadius: clamped });
    persistCornerRadiusDebounced(clamped);
  },
```

Find the existing `start: (p) =>` action and add `cornerRadius: p.cornerRadius ?? 0,` to the `set({ ... })` body alongside `monitorId`, `monitorRect`, etc.

Find the existing `end: () =>` action and add `cornerRadius: get().cornerRadius,` to its set object so the value survives session end (or omit the field from `end` if you prefer — the default behaviour of zustand preserves it when not overwritten; the explicit line documents intent).

- [ ] **Step 4: Run the new tests**

```bash
pnpm test -- corner-radius-store
```

Expected: 4 passing tests.

- [ ] **Step 5: Run the full Vitest suite**

```bash
pnpm test
```

Expected: all green. If `overlay-state.test.ts` fails because `start()` payloads don't include `cornerRadius`, update those test fixtures to add `cornerRadius: 0`.

- [ ] **Step 6: Commit**

```bash
git add src/overlay/state.ts src/__tests__/corner-radius-store.test.ts src/__tests__/overlay-state.test.ts
git commit -m "feat(overlay): track cornerRadius in store with debounced persistence"
```

---

## Task 8: Forward `cornerRadius` from IPC wrappers

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/__tests__/ipc.test.ts`

- [ ] **Step 1: Update the failing test**

Open `src/__tests__/ipc.test.ts` and find the existing tests for `cropAndCopy`, `cropAndSave`, `pinImage`. Add three new assertions (one per command). Below the existing test cases, append:

```ts
describe("cropAndCopy/Save/pinImage forward cornerRadius", () => {
  it("forwards cornerRadius to crop_and_copy", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cropAndCopy(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 12);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "crop_and_copy",
      expect.objectContaining({ cornerRadius: 12 }),
    );
  });

  it("forwards cornerRadius to crop_and_save", async () => {
    invokeMock.mockResolvedValue(null);
    await cropAndSave(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 8);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "crop_and_save",
      expect.objectContaining({ cornerRadius: 8 }),
    );
  });

  it("forwards cornerRadius to pin_image", async () => {
    invokeMock.mockResolvedValue("pin-1");
    await pinImage(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 4);
    expect(invokeMock).toHaveBeenLastCalledWith(
      "pin_image",
      expect.objectContaining({ cornerRadius: 4 }),
    );
  });
});
```

Open the file first to inspect the mock setup; reuse the existing `invokeMock` and imports rather than redefining them. Adjust the imports at the top of `ipc.test.ts` so `cropAndCopy`, `cropAndSave`, `pinImage` are in scope (they likely already are).

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- ipc
```

Expected: 3 failing tests.

- [ ] **Step 3: Update the wrappers**

Edit `src/lib/ipc.ts`. Replace these three functions:

```ts
export async function cropAndCopy(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<void> {
  await invoke("crop_and_copy", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
}
export async function cropAndSave(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<string | null> {
  return await invoke<string | null>("crop_and_save", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
}
export async function pinImage(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<string> {
  return await invoke<string>("pin_image", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
pnpm test -- ipc
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/__tests__/ipc.test.ts
git commit -m "feat(ipc): forward cornerRadius to crop and pin commands"
```

---

## Task 9: Wire `cornerRadius` into Overlay route handlers

**Files:**
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Update handlers**

Open `src/routes/Overlay.tsx`. Near the top of `OverlayRoute`, add a selector:

```ts
  const cornerRadius = useOverlay((s) => s.cornerRadius);
```

Modify the three handler functions to pass the value:

```ts
  const handleCopy = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await cropAndCopy(monitorId, selection, annotationPng ?? undefined, cornerRadius);
  };

  const handleSave = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await cropAndSave(monitorId, selection, annotationPng ?? undefined, cornerRadius);
  };

  const handlePin = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await pinImage(monitorId, selection, annotationPng ?? undefined, cornerRadius);
  };
```

- [ ] **Step 2: Run lint + relevant tests**

```bash
pnpm lint && pnpm test -- overlay-route
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/routes/Overlay.tsx
git commit -m "feat(overlay): pass cornerRadius through copy/save/pin handlers"
```

---

## Task 10: Extract `useDismissOnOutsideMouseDown` hook

**Files:**
- Create: `src/lib/useDismissOnOutsideMouseDown.ts`
- Modify: `src/annotation/PropertyPanel.tsx`

- [ ] **Step 1: Create the hook file**

Create `src/lib/useDismissOnOutsideMouseDown.ts`:

```ts
import { useEffect, type RefObject } from "react";

export function useDismissOnOutsideMouseDown<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [open, ref, onDismiss]);
}
```

- [ ] **Step 2: Replace the inline copy in `PropertyPanel.tsx`**

In `src/annotation/PropertyPanel.tsx`, delete the local `function useDismissOnOutsideMouseDown<T extends HTMLElement>(...)` definition. At the top of the file, add:

```ts
import { useDismissOnOutsideMouseDown } from "@/lib/useDismissOnOutsideMouseDown";
```

- [ ] **Step 3: Run the full frontend suite**

```bash
pnpm test
```

Expected: all green (no behavioural change).

- [ ] **Step 4: Commit**

```bash
git add src/lib/useDismissOnOutsideMouseDown.ts src/annotation/PropertyPanel.tsx
git commit -m "refactor(ui): extract useDismissOnOutsideMouseDown to shared module"
```

---

## Task 11: Create `CornerRadiusPanel` component

**Files:**
- Create: `src/overlay/CornerRadiusPanel.tsx`
- Create: `src/__tests__/corner-radius-panel.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/corner-radius-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";

function Harness({
  value,
  onChange,
  onDismiss,
}: {
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div data-testid="outside">outside</div>
      <CornerRadiusPanel
        panelRef={ref}
        value={value}
        onChange={onChange}
        onDismiss={onDismiss}
        style={{ position: "fixed", top: 0, left: 0 }}
      />
    </>
  );
}

describe("CornerRadiusPanel", () => {
  it("renders the current value with a px suffix", () => {
    const { getByText } = render(
      <Harness value={16} onChange={() => {}} onDismiss={() => {}} />,
    );
    expect(getByText("16 px")).toBeTruthy();
  });

  it("calls onChange with the slider's numeric value", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Harness value={0} onChange={onChange} onDismiss={() => {}} />,
    );
    const slider = getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "24" } });
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it("dismisses when the user clicks outside the panel", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Harness value={0} onChange={() => {}} onDismiss={onDismiss} />,
    );
    fireEvent.mouseDown(getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- corner-radius-panel
```

Expected: 3 failing tests (cannot import module).

- [ ] **Step 3: Implement the panel**

Create `src/overlay/CornerRadiusPanel.tsx`:

```tsx
import { useDismissOnOutsideMouseDown } from "@/lib/useDismissOnOutsideMouseDown";
import type { CSSProperties, RefObject } from "react";

const PANEL_BACKGROUND = "rgba(30, 30, 30, 0.95)";

type Props = {
  panelRef: RefObject<HTMLDivElement>;
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
  style?: CSSProperties;
};

export function CornerRadiusPanel({ panelRef, value, onChange, onDismiss, style }: Props) {
  useDismissOnOutsideMouseDown(true, panelRef, onDismiss);

  return (
    <div
      ref={panelRef}
      data-corner-radius-panel
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        background: PANEL_BACKGROUND,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.85)",
        fontSize: 12,
        userSelect: "none",
        zIndex: 10001,
        ...style,
      }}
    >
      <input
        type="range"
        min={0}
        max={60}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Corner radius"
        style={{
          width: 160,
          accentColor: "#60a5fa",
        }}
      />
      <span
        style={{
          minWidth: 36,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value} px
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
pnpm test -- corner-radius-panel
```

Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/CornerRadiusPanel.tsx src/__tests__/corner-radius-panel.test.tsx
git commit -m "feat(overlay): add CornerRadiusPanel slider popover"
```

---

## Task 12: Add corner-radius button to vertical Toolbar

**Files:**
- Modify: `src/overlay/Toolbar.tsx`
- Modify: `src/__tests__/toolbar.test.tsx`

- [ ] **Step 1: Write failing test**

Open `src/__tests__/toolbar.test.tsx`. Append a new describe block:

```tsx
describe("Toolbar corner radius control", () => {
  it("renders the corner radius button as the first action", () => {
    const setCornerRadius = vi.fn();
    useOverlay.setState({ cornerRadius: 0 });

    const { getByLabelText } = render(
      <Toolbar
        selection={{ x: 0, y: 0, width: 100, height: 100 }}
        monitorRect={{ x: 0, y: 0, width: 800, height: 600 }}
        onCopy={() => {}}
        onSave={() => {}}
        onPin={() => {}}
        onClose={() => {}}
        onScroll={() => {}}
      />,
    );

    const button = getByLabelText(/corner radius/i);
    expect(button).toBeTruthy();

    // Confirm button is positioned above Pin in DOM order
    const pinButton = getByLabelText("Pin");
    const position = button.compareDocumentPosition(pinButton);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the slider panel when clicked", () => {
    useOverlay.setState({ cornerRadius: 0 });
    const { getByLabelText, queryByRole } = render(
      <Toolbar
        selection={{ x: 0, y: 0, width: 100, height: 100 }}
        monitorRect={{ x: 0, y: 0, width: 800, height: 600 }}
        onCopy={() => {}}
        onSave={() => {}}
        onPin={() => {}}
        onClose={() => {}}
        onScroll={() => {}}
      />,
    );

    expect(queryByRole("slider")).toBeNull();
    fireEvent.click(getByLabelText(/corner radius/i));
    expect(queryByRole("slider")).not.toBeNull();
  });
});
```

If the existing `toolbar.test.tsx` does not import `useOverlay` or `fireEvent`, add them to the imports.

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- toolbar
```

Expected: 2 failing tests.

- [ ] **Step 3: Add the button and panel to `Toolbar.tsx`**

Edit `src/overlay/Toolbar.tsx`. At the top of the file, after the existing imports, add:

```ts
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";
import { useOverlay } from "@/overlay/state";
```

Inside the `Toolbar` function, just after the existing `useState`/`useRef` calls, add:

```ts
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  const setCornerRadius = useOverlay((s) => s.setCornerRadius);
  const [radiusPanelOpen, setRadiusPanelOpen] = useState(false);
  const radiusPanelRef = useRef<HTMLDivElement>(null);
  const radiusButtonRef = useRef<HTMLButtonElement>(null);
```

In the JSX, replace the existing block starting at:

```jsx
      <Separator />

      <ToolbarGroup name="pin-scroll">
```

with the following — adding the corner-radius group before the pin-scroll group, plus the panel that follows the toolbar's left edge:

```jsx
      <Separator />

      <ToolbarGroup name="radius">
        <button
          ref={radiusButtonRef}
          type="button"
          aria-label={`Corner radius: ${cornerRadius} px`}
          title={`Corner radius: ${cornerRadius} px`}
          onClick={() => setRadiusPanelOpen((v) => !v)}
          style={{
            position: "relative",
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            background: radiusPanelOpen ? "rgba(255,255,255,0.15)" : "transparent",
            color: "rgba(255,255,255,0.78)",
            flexShrink: 0,
            transition: "background 0.1s, color 0.1s",
          }}
        >
          <CornerRadiusIcon size={18} radius={cornerRadius} />
        </button>
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup name="pin-scroll">
```

Then, just before the final closing `</div>` of the toolbar root, add the panel anchor block (still INSIDE the toolbar root so it inherits stacking, OR if positioning is tricky, append it as a sibling — the simpler choice is sibling). Restructure the return statement so the toolbar root and the panel both live inside a fragment:

```jsx
  return (
    <>
      <div ref={toolbarRef} ... existing props>
        {/* ...existing children unchanged... */}
      </div>
      {radiusPanelOpen && (
        <CornerRadiusPanel
          panelRef={radiusPanelRef}
          value={cornerRadius}
          onChange={setCornerRadius}
          onDismiss={() => setRadiusPanelOpen(false)}
          style={{
            position: "fixed",
            left: pos.x + TOOLBAR_SIZE.width + 8,
            top: pos.y + 4,
          }}
        />
      )}
    </>
  );
```

Below the `Toolbar` function, add the icon component:

```tsx
function CornerRadiusIcon({ size = 18, radius }: { size?: number; radius: number }) {
  const rx = 1 + (radius / 60) * 6;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx={rx} ry={rx} />
    </svg>
  );
}
```

- [ ] **Step 4: Run the toolbar tests + lint**

```bash
pnpm test -- toolbar && pnpm lint
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/Toolbar.tsx src/__tests__/toolbar.test.tsx
git commit -m "feat(toolbar): add corner radius button and slider popover"
```

---

## Task 13: Render SelectionBox outline as a rounded SVG `<rect>`

**Files:**
- Modify: `src/overlay/SelectionBox.tsx`
- Create: `src/__tests__/selection-box-rounded.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/selection-box-rounded.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SelectionBox } from "@/overlay/SelectionBox";
import { useOverlay } from "@/overlay/state";

describe("SelectionBox rounded outline", () => {
  beforeEach(() => {
    useOverlay.setState({
      mode: "committed",
      selection: { x: 10, y: 10, width: 100, height: 80 },
      cornerRadius: 0,
      colorPickerVisible: false,
    });
  });

  it("renders a rounded SVG rect when cornerRadius > 0", () => {
    useOverlay.setState({ cornerRadius: 12 });
    const { container } = render(<SelectionBox />);
    const rect = container.querySelector("svg rect");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("rx")).toBe("12");
  });

  it("forces rx=0 during scrolling regardless of store cornerRadius", () => {
    useOverlay.setState({ cornerRadius: 20, mode: "scrolling" });
    const { container } = render(<SelectionBox />);
    const rect = container.querySelector("svg rect");
    expect(rect?.getAttribute("rx")).toBe("0");
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- selection-box-rounded
```

Expected: 2 failing tests.

- [ ] **Step 3: Rewrite the outline rendering**

Edit `src/overlay/SelectionBox.tsx`. Replace the existing outline `<div>` block that uses `outline: \`1.5px solid ${COLOR}\`` with an SVG sibling. The full updated rendering of the outline portion looks like:

```tsx
export function SelectionBox() {
  const r = useOverlay((s) => s.selection);
  const mode = useOverlay((s) => s.mode);
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  const storeRadius = useOverlay((s) => s.cornerRadius);
  if (!r) return null;

  const effectiveRadius =
    mode === "scrollStarting" || mode === "scrolling" ? 0 : storeRadius;

  const hx = (x: number) => x - 4;
  const hy = (y: number) => y - 4;
  const handleCursor = (id: HandleId) =>
    colorPickerVisible ? "crosshair" : cursorForHandle(id);
  const handle = (id: HandleId, left: number, top: number) => (
    <div
      style={{ ...handleStyle, left, top, cursor: handleCursor(id) }}
      data-handle={id}
    />
  );

  return (
    <>
      <svg
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.width,
          height: r.height,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <rect
          x="0"
          y="0"
          width={r.width}
          height={r.height}
          rx={effectiveRadius}
          ry={effectiveRadius}
          fill="none"
          stroke={COLOR}
          strokeWidth={1.5}
          shapeRendering="geometricPrecision"
        />
      </svg>
      {mode !== "scrollStarting" && mode !== "scrolling" && (
        <div
          style={{
            position: "absolute",
            left: r.x + 6,
            top: r.y - 22,
            background: FLOATING_LABEL_BACKGROUND,
            color: COLOR,
            padding: "2px 6px",
            fontSize: 11,
            borderRadius: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            pointerEvents: "none",
          }}
        >
          {Math.round(r.width)} × {Math.round(r.height)}
        </div>
      )}
      {mode === "committed" && (
        <>
          {handle("nw", hx(r.x), hy(r.y))}
          {handle("n", hx(r.x + r.width / 2), hy(r.y))}
          {handle("ne", hx(r.x + r.width), hy(r.y))}
          {handle("e", hx(r.x + r.width), hy(r.y + r.height / 2))}
          {handle("se", hx(r.x + r.width), hy(r.y + r.height))}
          {handle("s", hx(r.x + r.width / 2), hy(r.y + r.height))}
          {handle("sw", hx(r.x), hy(r.y + r.height))}
          {handle("w", hx(r.x), hy(r.y + r.height / 2))}
        </>
      )}
    </>
  );
}
```

Note: the old comment about `outline` vs `border` no longer applies because the SVG `<rect>` with `fill="none"` paints only on the edge, not inside. The scroll-mode guard now zeroes the radius, so scrolling capture sees a sharp rectangle (same physical pixels as before).

- [ ] **Step 4: Run tests**

```bash
pnpm test -- selection-box-rounded && pnpm test -- selection-box
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/SelectionBox.tsx src/__tests__/selection-box-rounded.test.tsx
git commit -m "feat(overlay): render selection outline as rounded SVG"
```

---

## Task 14: Render DimMask with a rounded SVG hole

**Files:**
- Modify: `src/overlay/DimMask.tsx`
- Create: `src/__tests__/dim-mask-rounded.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/dim-mask-rounded.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DimMask } from "@/overlay/DimMask";
import { useOverlay } from "@/overlay/state";

describe("DimMask rounded hole", () => {
  beforeEach(() => {
    useOverlay.setState({
      mode: "committed",
      monitorRect: { x: 0, y: 0, width: 800, height: 600 },
      selection: { x: 100, y: 100, width: 200, height: 150 },
      hoverRect: null,
      cornerRadius: 0,
    });
  });

  it("renders a hole rect with the live cornerRadius as rx", () => {
    useOverlay.setState({ cornerRadius: 16 });
    const { container } = render(<DimMask />);
    const holeRect = container.querySelector("svg mask rect[fill='black']");
    expect(holeRect).not.toBeNull();
    expect(holeRect?.getAttribute("rx")).toBe("16");
  });

  it("forces a sharp hole during scrolling capture", () => {
    useOverlay.setState({ cornerRadius: 16, mode: "scrolling" });
    const { container } = render(<DimMask />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

```bash
pnpm test -- dim-mask-rounded
```

Expected: 2 failing tests.

- [ ] **Step 3: Rewrite `DimMask.tsx`**

Replace the contents of `src/overlay/DimMask.tsx` with:

```tsx
import { useOverlay } from "@/overlay/state";

const DIM = "rgba(0,0,0,0.55)";
const MASK_ID = "flashot-dim-hole";

export function DimMask() {
  const monitor = useOverlay((s) => s.monitorRect);
  const mode = useOverlay((s) => s.mode);
  const sel = useOverlay((s) => s.selection ?? s.hoverRect);
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  if (!monitor) return null;
  if (mode === "scrollStarting" || mode === "scrolling") return null;
  if (!sel) {
    if (mode !== "hover" && mode !== "dragging" && mode !== "locked") return null;
    return (
      <div
        data-dim-mask="full"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: monitor.width,
          height: monitor.height,
          background: DIM,
          pointerEvents: "none",
        }}
      />
    );
  }

  return (
    <svg
      data-dim-mask="partial"
      width={monitor.width}
      height={monitor.height}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
      }}
    >
      <defs>
        <mask id={MASK_ID}>
          <rect x="0" y="0" width={monitor.width} height={monitor.height} fill="white" />
          <rect
            x={sel.x}
            y={sel.y}
            width={sel.width}
            height={sel.height}
            rx={cornerRadius}
            ry={cornerRadius}
            fill="black"
          />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width={monitor.width}
        height={monitor.height}
        fill={DIM}
        mask={`url(#${MASK_ID})`}
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- dim-mask
```

Expected: green. The existing `dim-mask` tests (if any) checking partial vs full coverage may need to be updated — if a previous test queried for the 4-div approach, replace its DOM queries with the SVG mask check above.

- [ ] **Step 5: Commit**

```bash
git add src/overlay/DimMask.tsx src/__tests__/dim-mask-rounded.test.tsx
git commit -m "feat(overlay): mask dim layer with rounded SVG hole"
```

---

## Task 15: Apply `border-radius` in the Pin route

**Files:**
- Modify: `src/routes/Pin.tsx`
- Modify: `src/__tests__/pin-route.test.tsx`

- [ ] **Step 1: Add failing test**

Open `src/__tests__/pin-route.test.tsx`. Add a new test case:

```tsx
it("applies border-radius from ?radius= query param", () => {
  // Replace setup to render pin window at #/pin/<id>?radius=8
  window.location.hash = "#/pin/abc?radius=8";
  // ...render Pin route via MemoryRouter / existing harness in this file
  const img = document.querySelector("img[alt='Pinned screenshot']") as HTMLImageElement;
  expect(img.style.borderRadius).toBe("8px");
});
```

If the existing test file uses a router harness, mirror that harness for this case. Otherwise, render `<Pin />` directly inside a `MemoryRouter initialEntries={["/pin/abc?radius=8"]}` (whichever pattern the rest of `pin-route.test.tsx` already uses).

- [ ] **Step 2: Run and confirm test fails**

```bash
pnpm test -- pin-route
```

Expected: 1 failing test.

- [ ] **Step 3: Read the radius and apply it**

Edit `src/routes/Pin.tsx`. Locate the existing `parsePinRoute()` helper (around line 23) and add a `radius` field to its return type. Replace the helper with:

```ts
function parsePinRoute(): { id: string; hasAnnotation: boolean; radius: number } | null {
  const h = window.location.hash || "";
  const prefix = "#/pin/";
  if (!h.startsWith(prefix)) return null;
  const rest = h.slice(prefix.length);
  const [idPart, queryPart = ""] = rest.split("?");
  const id = idPart.split(/[/?#]/)[0];
  if (!id) return null;
  const query = queryPart.split("#")[0];
  const params = new URLSearchParams(query);
  const radiusRaw = Number(params.get("radius") ?? "0");
  const radius = Number.isFinite(radiusRaw) ? Math.max(0, Math.min(60, radiusRaw)) : 0;
  return {
    id,
    hasAnnotation: params.get("annotation") === "1",
    radius,
  };
}
```

Inside `PinRoute()`, add the `radius` extraction next to the existing fields:

```ts
  const radius = pinRoute?.radius ?? 0;
```

Update `imgStyle` (currently inside `PinRoute`) to include `borderRadius`:

```ts
  const imgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
    boxShadow: PIN_GLOW,
    borderRadius: radius,
  };
```

The module-level `annotationStyle` constant must close over `radius` too. Move its declaration *inside* `PinRoute` (just after `imgStyle`):

```ts
  const annotationStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
    borderRadius: radius,
  };
```

Then delete the original module-level `const annotationStyle: CSSProperties = { ... };` declaration near the bottom of the file.

- [ ] **Step 4: Run tests**

```bash
pnpm test -- pin-route
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Pin.tsx src/__tests__/pin-route.test.tsx
git commit -m "feat(pin): apply border-radius from radius query param"
```

---

## Task 16: Full-suite verification

**Files:** none — verification only.

- [ ] **Step 1: Run the entire Vitest suite**

```bash
pnpm test
```

Expected: all green. If a test that constructs a `Settings` or `CaptureStartPayload` literal fails because of the new `cornerRadius` field, add `cornerRadius: 0` to the fixture and re-run.

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 3: Run the Rust suite + clippy**

```bash
cd src-tauri && cargo test --no-fail-fast && cargo clippy --all-targets -- -D warnings && cd ..
```

Expected: all green, no warnings.

- [ ] **Step 4: Run the crop benchmark to confirm we're within budget**

```bash
cd src-tauri && cargo bench --bench crop_bench && cd ..
```

Expected: well below the 8 ms target. The mask adds <1 ms on a typical region.

- [ ] **Step 5: Manual end-to-end (macOS)**

Start the dev build:

```bash
pnpm tauri dev
```

Verify, in order:
1. Press the capture hotkey; corner-radius button is the first item in the vertical toolbar (above Pin).
2. Click the button: a slider popover appears anchored to the right of the toolbar.
3. Drag the slider from 0 to 30 to 0: the selection outline and dim-mask hole round and unround smoothly without jank.
4. With radius 16, click Copy. Paste into an image editor (Preview → New from Clipboard, or any PNG viewer). Corners are transparent.
5. With radius 16, click Save. Open the saved PNG. Corners are transparent.
6. With radius 16, click Pin. The pin window shows a rounded image; the CSS glow follows the rounded outline. Drag the pin window; corners remain rounded.
7. Press Esc to close the pin window. Restart the app. Press the capture hotkey again; the slider opens at 16 (persisted).
8. Press the **fullscreen** quick-shot hotkey. Paste; the resulting image is rectangular (radius did NOT apply to full-display quick-shots).
9. Press the **active-window** quick-shot hotkey. Paste; the resulting image is rectangular.
10. With radius 16, capture a region, click the scrolling-screenshot button. The scrolling capture starts; the live preview selection outline is sharp (radius forced to 0 in scrolling mode). After stopping, copy the stitched image — it is rectangular.

If any step fails, file a follow-up note in the PR description and fix before merge.

- [ ] **Step 6: Final commit (if any fixture or polish edits)**

```bash
git add -A
git status        # review
git commit -m "chore(corner-radius): polish after manual verification"
```

Skip this step if there is nothing left to commit.

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Tasks |
|---|---|
| Settings field | 1 |
| `mask::apply_rounded_corners` | 2 |
| Backend command integration | 3 |
| Pin URL `?radius=` | 4 |
| `capture:start` payload | 5 |
| Frontend types | 6 |
| Overlay store + debounced persistence | 7 |
| IPC wrappers | 8 |
| Overlay handlers | 9 |
| Shared dismiss hook | 10 |
| `CornerRadiusPanel` | 11 |
| Toolbar button | 12 |
| `SelectionBox` SVG | 13 |
| `DimMask` SVG | 14 |
| Pin route `border-radius` | 15 |
| Manual verification | 16 |

Every spec section maps to at least one task. Tests 8 (`quick_shot_paths_do_not_apply_corner_radius`) and the manual steps 8–10 enforce the "quick-shots stay rectangular" constraint.

**Type consistency:** `cornerRadius` (camelCase) in TS, `corner_radius` (snake_case) in Rust, serde-renamed to `cornerRadius` over the wire — consistent across all files referenced in the plan.

**Risks repeated from spec:** Pin shadow alignment is mitigated by Task 4 (URL) + Task 15 (`border-radius`). SVG mask perf risk is observed manually in Step 5 of Task 16. Slider focus risk is mitigated by `onMouseDown` `stopPropagation` in the panel component (Task 11).
