# Screenshot Image Adjustments Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 6

## Problem

Users want lightweight image processing before output: grayscale, automatic brightness/contrast, saturation, and sharpness. These adjustments apply only to the screenshot base image; annotations stay visually unchanged so labels, arrows, and marks remain legible.

## Scope

In scope:

- Region capture output adjustments for copy, save, and pin.
- Live preview inside the overlay selection.
- Manual controls for grayscale, brightness, contrast, saturation, and sharpness.
- Auto button for brightness/contrast.
- Reset button.
- Preserve annotation colors by applying adjustments before annotation compositing.

Out of scope:

- Full photo editor workflow.
- Per-annotation color grading.
- Scrolling screenshot adjustments in the first pass.
- Quick-shot fullscreen/active-window adjustments unless explicitly added later.

## User-Facing Behavior

Add an image-adjustments button to the screenshot toolbar. It opens a compact panel with:

- grayscale toggle;
- auto enhance button;
- brightness slider;
- contrast slider;
- saturation slider;
- sharpness slider;
- reset button.

Adjustments preview live on the selected screenshot base layer. Annotations render above the adjusted image and remain unchanged.

## Data Model

Add:

```ts
type ImageAdjustments = {
  grayscale: boolean;
  autoLevels: boolean;
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
  sharpness: number;  // 0..100
};
```

The active capture session owns these values. A later settings task can decide whether to persist defaults.

## Architecture

Preview:

- CSS filters can handle grayscale, brightness, contrast, and saturation for live preview.
- Sharpness preview can be approximate or omitted from CSS preview if it would add expensive canvas work.

Output:

- Extend crop IPC wrappers and Rust commands with `adjustments`.
- Apply adjustments to the cropped base image before annotation compositing.
- Apply rounded-corner masking after compositing, preserving current behavior.

Add a Rust module `src-tauri/src/image_adjust.rs` with pure functions over RGBA buffers.

## Testing

- Frontend store tests for default/reset/clamping.
- IPC serialization tests.
- Rust unit tests for grayscale, brightness/contrast, saturation, and no-op behavior.
- Existing crop tests must continue to pass.
