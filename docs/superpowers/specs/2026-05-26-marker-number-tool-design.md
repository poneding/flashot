# Number Marker Tool Design

**Status:** Draft
**Date:** 2026-05-26
**Related TODO:** `tmp/TODO.md` item 3

## Problem

Users need a compact way to label important regions in a screenshot with ordered markers. The marker should be a numbered circle. Optionally, it can include a message-bubble label for short text. If no text is entered, only the numbered circle is shown.

## Scope

In scope:

- New annotation tool: `marker`.
- Auto-incremented current marker number per capture session.
- Manual current-number adjustment so users can start a new marker series from a chosen number.
- Circular marker badge with configurable color.
- Optional message bubble with editable text and configurable background color.
- Move, select, delete, undo/redo, copy/save/pin export.

Out of scope:

- Renumbering existing marker objects after deletion.
- Rich text inside the bubble.
- Connector lines between marker and bubble.

## User-Facing Behavior

Click the Marker tool, then click inside the selected screenshot. Flashot creates a marker with the current number, then increments the current number by 1. The marker is selected immediately. A small inline editor opens for optional text. Pressing Enter commits text; Escape cancels the editor without deleting the marker.

Deleting a marker decrements the current marker number by 1, clamped so it never goes below 1. Existing marker objects keep the number they were created with. Manual adjustment changes only the current number used for the next marker; this intentionally allows users to start another series from 1 or any other chosen value without rewriting old markers.

If text is empty, render only the circle. If text exists, render the circle plus a rounded speech-bubble label to the right. The label background color is configurable from the property panel.

## Data Model

Extend annotation types:

```ts
type ToolType = ... | "marker";

type AnnotationObject = {
  type: ... | "marker";
  markerNumber?: number;
  text?: string;
  style: AnnotationStyle;
};

type AnnotationStyle = {
  markerFill?: string;
  markerTextColor?: string;
  markerBubbleFill?: string;
};
```

Marker number is stored on the object so undo/redo and export are stable. The annotation store also keeps `currentMarkerNumber`, initialized to `1`.

## Architecture

Add `src/annotation/tools/marker.ts` for creation and rendering helpers. Marker rendering should be a `Konva.Group` with:

- circle badge;
- centered number text;
- optional bubble rect and text node.

Reuse `TextOverlay` patterns for editing, but keep marker text editing separate from normal text annotations because marker editing needs badge-aware positioning and empty-text behavior.

## Testing

- Store test for marker number allocation.
- Tool test for marker object creation.
- Render test for empty and text-bearing markers.
- Toolbar test for marker button.
- Stage test for edit/commit flow.
