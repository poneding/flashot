# Measurement Annotation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Measure annotation tool that draws a straight line on a screenshot selection and labels its logical pixel length.

**Architecture:** Implement measurement entirely in the existing frontend annotation layer. A new `measure` annotation object renders through Konva, exports through the existing transparent PNG annotation pipeline, and uses the existing command stack for undo/redo. Measurement objects are endpoint-editable like lines, but they do not support curves, arrows, or physical pixel units.

**Tech Stack:** React 18, TypeScript, Zustand, Konva, Vitest, React Testing Library, Tauri IPC only through the existing annotation export path.

---

## Scope Check

This plan covers one subsystem: the annotation layer. No Rust command, capture
session, settings store, or IPC surface needs to change.

## File Structure

- Create: `src/annotation/tools/measure.ts`
  - Owns measurement math, preview drawing, object creation, Konva rendering,
    label placement, and node updates after endpoint edits.
- Create: `src/__tests__/annotation-measure-tool.test.ts`
  - Focused tests for measurement length, preview lifecycle, object creation,
    and rendered label content.
- Modify: `src/annotation/types.ts`
  - Adds `measure` to tool and object unions.
- Modify: `src/annotation/store.ts`
  - Normalizes measurement style to color and stroke width, while ignoring
    line shape, line dash, and arrows.
- Modify: `src/annotation/render.ts`
  - Dispatches `measure` objects to `renderMeasureObject`.
- Modify: `src/annotation/Stage.tsx`
  - Registers measure tool handlers and treats measure objects as
    endpoint-editable objects without a Konva Transformer.
- Modify: `src/annotation/Toolbar.tsx`
  - Adds the Measure toolbar button.
- Modify: `src/annotation/PropertyPanel.tsx`
  - Adds the compact measure property panel with color and stroke width.
- Modify: `src/__tests__/annotation-store.test.ts`
  - Covers selecting `measure` and style normalization.
- Modify: `src/__tests__/annotation-render.test.ts`
  - Covers measure object rendering.
- Modify: `src/__tests__/annotation-stage-helpers.test.ts`
  - Covers Transformer exclusion and replacement logic for `measure`.
- Modify: `src/__tests__/annotation-toolbar.test.tsx`
  - Covers Measure tool availability and selection.
- Modify: `src/__tests__/annotation-property-panel.test.tsx`
  - Covers measure property controls.
- Modify: `src/__tests__/annotation-export.test.ts`
  - Covers that measure edit overlays use the existing export hiding path.

---

### Task 1: Add Measure Type And Store Style Normalization

**Files:**
- Modify: `src/annotation/types.ts`
- Modify: `src/annotation/store.ts`
- Test: `src/__tests__/annotation-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Add these tests to `src/__tests__/annotation-store.test.ts`:

```ts
  it("sets the measure tool as the active tool", () => {
    useAnnotation.getState().setActiveTool("measure");

    expect(useAnnotation.getState().activeTool).toBe("measure");
    expect(useAnnotation.getState().selectedObjectId).toBeNull();
  });

  it("normalizes measure style to straight solid non-arrow measurements", () => {
    useAnnotation.getState().setActiveStyle({
      color: "#0099ff",
      strokeWidth: 6,
      lineShape: "wavy",
      lineStyle: "dashed",
      arrow: "both",
    });

    useAnnotation.getState().setActiveTool("measure");

    expect(useAnnotation.getState().activeStyle.color).toBe("#0099ff");
    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(6);
    expect(useAnnotation.getState().activeStyle.lineShape).toBe("straight");
    expect(useAnnotation.getState().activeStyle.lineStyle).toBe("solid");
    expect(useAnnotation.getState().activeStyle.arrow).toBe("none");
  });
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run:

```bash
pnpm test -- src/__tests__/annotation-store.test.ts
```

Expected: FAIL with TypeScript errors because `"measure"` is not assignable to
`ToolType`.

- [ ] **Step 3: Add measure to annotation types**

In `src/annotation/types.ts`, add `measure` to `ToolType`:

```ts
export type ToolType =
  | "select"
  | "draw"
  | "line"
  | "measure"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "blur"
  | "highlight"
  | "eraser";
```

In the same file, add `measure` to `AnnotationObject["type"]`:

```ts
export type AnnotationObject = {
  id: AnnotationId;
  type: "draw" | "line" | "measure" | "arrow" | "rect" | "ellipse" | "text" | "blur" | "highlight";
  points?: number[];
  start?: Point;
  end?: Point;
  text?: string;
  style: AnnotationStyle;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  };
};
```

- [ ] **Step 4: Normalize measure styles in the store**

In `src/annotation/store.ts`, update `ToolStyleMemory`:

```ts
type ToolStyleMemory = {
  line: Pick<AnnotationStyle, "lineShape" | "lineStyle">;
  arrow: Pick<AnnotationStyle, "lineStyle" | "arrowStyle">;
  measure: Pick<AnnotationStyle, "color" | "strokeWidth">;
};
```

Add this helper after `arrowToolStyle`:

```ts
function measureToolStyle(style: Partial<AnnotationStyle>): ToolStyleMemory["measure"] {
  return {
    color: style.color ?? DEFAULT_STYLE.color,
    strokeWidth: style.strokeWidth ?? DEFAULT_STYLE.strokeWidth,
  };
}
```

Update `createToolStyleMemory`:

```ts
function createToolStyleMemory(style: AnnotationStyle): ToolStyleMemory {
  return {
    line: lineToolStyle(style),
    arrow: arrowToolStyle(style),
    measure: measureToolStyle(style),
  };
}
```

Update `normalizeActiveStyleForTool`:

```ts
function normalizeActiveStyleForTool(tool: ToolType, style: AnnotationStyle): AnnotationStyle {
  style = normalizeTextStyle(style);
  if (tool === "line") {
    return { ...style, ...lineToolStyle(style) };
  }
  if (tool === "arrow") {
    return { ...style, lineShape: "straight", ...arrowToolStyle(style) };
  }
  if (tool === "measure") {
    return {
      ...style,
      ...measureToolStyle(style),
      lineShape: "straight",
      lineStyle: "solid",
      arrow: "none",
    };
  }
  return style;
}
```

Update `rememberToolStyle`:

```ts
function rememberToolStyle(tool: ToolType, style: AnnotationStyle) {
  if (tool === "line") {
    toolStyleMemory.line = lineToolStyle(style);
  } else if (tool === "arrow") {
    toolStyleMemory.arrow = arrowToolStyle(style);
  } else if (tool === "measure") {
    toolStyleMemory.measure = measureToolStyle(style);
  }
}
```

Update `styleForTool`:

```ts
function styleForTool(tool: ToolType, baseStyle: AnnotationStyle): AnnotationStyle {
  if (tool === "line") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.line });
  }
  if (tool === "arrow") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.arrow });
  }
  if (tool === "measure") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.measure });
  }
  return baseStyle;
}
```

- [ ] **Step 5: Run the store tests to verify they pass**

Run:

```bash
pnpm test -- src/__tests__/annotation-store.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/annotation/types.ts src/annotation/store.ts src/__tests__/annotation-store.test.ts
git commit -m "feat: add measurement annotation type"
```

---

### Task 2: Implement Measure Tool Rendering And Creation

**Files:**
- Create: `src/annotation/tools/measure.ts`
- Test: `src/__tests__/annotation-measure-tool.test.ts`

- [ ] **Step 1: Create failing measure tool tests**

Create `src/__tests__/annotation-measure-tool.test.ts`:

```ts
/** @vitest-environment jsdom */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Konva from "konva";
import { useAnnotation } from "@/annotation/store";
import {
  measureLabel,
  measureLength,
  onMeasureEnd,
  onMeasureMove,
  onMeasureStart,
  renderMeasureObject,
} from "@/annotation/tools/measure";

const layer = {
  add: vi.fn(),
  batchDraw: vi.fn(),
};

vi.mock("@/annotation/Stage", () => ({
  getLayer: () => layer,
}));

describe("measure annotation tool", () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })),
      measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    } as unknown as CanvasRenderingContext2D);
  });

  beforeEach(() => {
    layer.add.mockClear();
    layer.batchDraw.mockClear();
    useAnnotation.getState().reset();
    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ color: "#ff0000", strokeWidth: 4 });
  });

  it("computes logical pixel distance labels", () => {
    expect(measureLength({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(measureLabel({ x: 10, y: 20 }, { x: 110, y: 20 })).toBe("100 px");
  });

  it("creates a measure object with a live label", () => {
    onMeasureStart(10, 20);
    onMeasureMove(13, 24);

    const obj = onMeasureEnd(13, 24);
    const group = layer.add.mock.calls[0][0] as Konva.Group;
    const mainLine = group.findOne(".measure-main-line") as Konva.Line;
    const label = group.findOne(".measure-label") as Konva.Text;

    expect(obj?.type).toBe("measure");
    expect(obj?.start).toEqual({ x: 10, y: 20 });
    expect(obj?.end).toEqual({ x: 13, y: 24 });
    expect(group.x()).toBe(10);
    expect(group.y()).toBe(20);
    expect(mainLine.points()).toEqual([0, 0, 3, 4]);
    expect(label.text()).toBe("5 px");
  });

  it("discards tiny measure drags", () => {
    onMeasureStart(10, 20);

    expect(onMeasureEnd(12, 22)).toBeNull();
  });

  it("renders a committed measurement from stored points", () => {
    const node = renderMeasureObject({
      id: "measure-1",
      type: "measure",
      start: { x: 10, y: 20 },
      end: { x: 110, y: 20 },
      style: { color: "#0099ff", strokeWidth: 6 },
      transform: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const label = node.findOne(".measure-label") as Konva.Text;
    const ticks = node.find(".measure-tick");

    expect(node.x()).toBe(15);
    expect(node.y()).toBe(27);
    expect(label.text()).toBe("100 px");
    expect(ticks).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run measure tool tests to verify they fail**

Run:

```bash
pnpm test -- src/__tests__/annotation-measure-tool.test.ts
```

Expected: FAIL because `@/annotation/tools/measure` does not exist.

- [ ] **Step 3: Create the measure tool implementation**

Create `src/annotation/tools/measure.ts`:

```ts
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";
import type { Point } from "@/lib/types";

let currentGroup: Konva.Group | null = null;
let startX = 0;
let startY = 0;

const MIN_MEASURE_DISTANCE = 4;
const LABEL_FONT_SIZE = 12;
const LABEL_HEIGHT = 20;
const LABEL_PADDING_X = 7;
const LABEL_MIN_WIDTH = 38;
const LABEL_OFFSET = 18;

export function measureLength(start: Point, end: Point): number {
  return Math.round(Math.hypot(end.x - start.x, end.y - start.y));
}

export function measureLabel(start: Point, end: Point): string {
  return `${measureLength(start, end)} px`;
}

function estimateLabelWidth(text: string): number {
  return Math.max(LABEL_MIN_WIDTH, Math.ceil(text.length * LABEL_FONT_SIZE * 0.58) + LABEL_PADDING_X * 2);
}

function unitVector(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

function perpendicularUnit(dx: number, dy: number): Point {
  const unit = unitVector(dx, dy);
  return { x: -unit.y, y: unit.x };
}

function tickPoints(x: number, y: number, normal: Point, halfLength: number): number[] {
  return [
    x - normal.x * halfLength,
    y - normal.y * halfLength,
    x + normal.x * halfLength,
    y + normal.y * halfLength,
  ];
}

function buildMeasureObjectChildren(group: Konva.Group, obj: AnnotationObject) {
  group.destroyChildren();

  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;
  const style = obj.style;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const normal = perpendicularUnit(dx, dy);
  const tickHalfLength = Math.max(6, style.strokeWidth * 1.6);
  const label = measureLabel(start, end);
  const labelWidth = estimateLabelWidth(label);
  const labelOffset = Math.max(LABEL_OFFSET, style.strokeWidth * 2 + 10);
  const labelX = dx / 2 + normal.x * labelOffset - labelWidth / 2;
  const labelY = dy / 2 + normal.y * labelOffset - LABEL_HEIGHT / 2;

  group.add(new Konva.Line({
    points: [0, 0, dx, dy],
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
    name: "measure-main-line",
  }));

  group.add(new Konva.Line({
    points: tickPoints(0, 0, normal, tickHalfLength),
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    name: "measure-tick",
  }));

  group.add(new Konva.Line({
    points: tickPoints(dx, dy, normal, tickHalfLength),
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    name: "measure-tick",
  }));

  group.add(new Konva.Rect({
    x: labelX,
    y: labelY,
    width: labelWidth,
    height: LABEL_HEIGHT,
    cornerRadius: 5,
    fill: "rgba(20,20,20,0.86)",
    listening: false,
    name: "measure-label-bg",
  }));

  group.add(new Konva.Text({
    x: labelX,
    y: labelY + 3,
    width: labelWidth,
    height: LABEL_HEIGHT,
    text: label,
    fill: "#ffffff",
    fontFamily: "system-ui",
    fontSize: LABEL_FONT_SIZE,
    fontStyle: "bold",
    align: "center",
    listening: false,
    name: "measure-label",
  }));
}

function makeMeasureObject(x: number, y: number, style: AnnotationStyle, id = crypto.randomUUID()): AnnotationObject {
  return {
    id,
    type: "measure",
    start: { x: startX, y: startY },
    end: { x, y },
    style: {
      ...style,
      lineShape: "straight",
      lineStyle: "solid",
      arrow: "none",
    },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

export function onMeasureStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  startX = x;
  startY = y;
  currentGroup = new Konva.Group({ listening: false, x, y });
  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle, "measure-preview");
  buildMeasureObjectChildren(currentGroup, obj);
  layer.add(currentGroup);
}

export function onMeasureMove(x: number, y: number) {
  if (!currentGroup) return;
  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle, "measure-preview");
  buildMeasureObjectChildren(currentGroup, obj);
  getLayer()?.batchDraw();
}

export function onMeasureEnd(x: number, y: number): AnnotationObject | null {
  if (!currentGroup || Math.hypot(x - startX, y - startY) < MIN_MEASURE_DISTANCE) {
    currentGroup?.destroy();
    currentGroup = null;
    return null;
  }

  const obj = makeMeasureObject(x, y, useAnnotation.getState().activeStyle);
  currentGroup.id(obj.id);
  currentGroup.listening(true);
  currentGroup.draggable(false);
  currentGroup.position({ x: obj.start!.x, y: obj.start!.y });
  buildMeasureObjectChildren(currentGroup, obj);
  currentGroup = null;
  return obj;
}

export function updateMeasureObjectNode(group: Konva.Group, obj: AnnotationObject) {
  buildMeasureObjectChildren(group, obj);
}

export function renderMeasureObject(obj: AnnotationObject): Konva.Group {
  const transform = obj.transform;
  const start = obj.start ?? { x: 0, y: 0 };
  const group = new Konva.Group({
    id: obj.id,
    draggable: false,
    x: start.x + transform.x,
    y: start.y + transform.y,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
  });

  buildMeasureObjectChildren(group, obj);
  return group;
}
```

- [ ] **Step 4: Run measure tool tests to verify they pass**

Run:

```bash
pnpm test -- src/__tests__/annotation-measure-tool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/annotation/tools/measure.ts src/__tests__/annotation-measure-tool.test.ts
git commit -m "feat: render measurement annotations"
```

---

### Task 3: Integrate Measure Rendering And Endpoint Editing

**Files:**
- Modify: `src/annotation/render.ts`
- Modify: `src/annotation/Stage.tsx`
- Modify: `src/__tests__/annotation-render.test.ts`
- Modify: `src/__tests__/annotation-stage-helpers.test.ts`

- [ ] **Step 1: Write failing render and Stage helper tests**

In `src/__tests__/annotation-render.test.ts`, add `renderMeasureObject` to the
imports:

```ts
import { renderMeasureObject } from "@/annotation/tools/measure";
import { renderObject } from "@/annotation/render";
```

Add this test inside `describe("annotation object rendering", () => { ... })`:

```ts
  it("renders measurement labels from logical endpoint distance", () => {
    const measure = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 5, y: 6, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const node = renderMeasureObject(measure);
    const label = node.findOne(".measure-label") as Konva.Text;
    const background = node.findOne(".measure-label-bg") as Konva.Rect;

    expect(node.draggable()).toBe(false);
    expect(node.x()).toBe(5);
    expect(node.y()).toBe(6);
    expect(label.text()).toBe("50 px");
    expect(background.fill()).toBe("rgba(20,20,20,0.86)");
  });
```

Add this generic renderer dispatch test:

```ts
  it("dispatches measurement objects through renderObject", () => {
    const measure = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    const node = renderObject(measure) as Konva.Group;
    const label = node.findOne(".measure-label") as Konva.Text;

    expect(label.text()).toBe("50 px");
  });
```

In `src/__tests__/annotation-stage-helpers.test.ts`, update the transformer
test:

```ts
  it("excludes lines, arrows, and measurements from transformer resize/rotate editing", () => {
    expect(transformerConfigForObject(object({ type: "line" })).useTransformer).toBe(false);
    expect(transformerConfigForObject(object({ type: "arrow" })).useTransformer).toBe(false);
    expect(transformerConfigForObject(object({ type: "measure" })).useTransformer).toBe(false);
  });
```

Add this helper test:

```ts
  it("replaces rendered measurements when endpoints change", () => {
    const before = object({
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
    });
    const after = {
      ...before,
      end: { x: 60, y: 80 },
    };

    expect(shouldReplaceRenderedObject(before, after)).toBe(true);
  });
```

- [ ] **Step 2: Run render and Stage helper tests to verify they fail**

Run:

```bash
pnpm test -- src/__tests__/annotation-render.test.ts src/__tests__/annotation-stage-helpers.test.ts
```

Expected: FAIL because `measure` is not dispatched and Stage does not treat
measure as endpoint-editable.

- [ ] **Step 3: Dispatch measure objects in render.ts**

Update `src/annotation/render.ts`:

```ts
import { renderMeasureObject } from "@/annotation/tools/measure";
```

Add the switch case:

```ts
    case "measure": return renderMeasureObject(obj);
```

- [ ] **Step 4: Register measure handlers in Stage.tsx**

In `src/annotation/Stage.tsx`, add this import:

```ts
import {
  onMeasureStart,
  onMeasureMove,
  onMeasureEnd,
  updateMeasureObjectNode,
} from "@/annotation/tools/measure";
```

Update `TOOL_HANDLERS`:

```ts
  measure: { start: onMeasureStart, move: onMeasureMove, end: onMeasureEnd },
```

Update `objectBasePosition` so measure uses the same base position as line-like
objects:

```ts
  if (obj.type === "line" || obj.type === "arrow" || obj.type === "measure") {
    return start;
  }
```

- [ ] **Step 5: Make measurement endpoint-editable without a Transformer**

In `src/annotation/Stage.tsx`, replace `isLineObject` with:

```ts
type LineEditHandle = "start" | "control" | "end";

function isEndpointEditableObject(obj: AnnotationObject | undefined): boolean {
  return obj?.type === "line" || obj?.type === "arrow" || obj?.type === "measure";
}

function editableLineHandles(obj: AnnotationObject): LineEditHandle[] {
  return obj.type === "measure" ? ["start", "end"] : ["start", "control", "end"];
}
```

Update `transformerConfigForObject`:

```ts
  if (isEndpointEditableObject(obj)) return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
```

Update the selection rendering branch in `syncSelectionWithStore`:

```ts
  if (!config.useTransformer) {
    transformer.nodes([]);
    if (selectedObject && isEndpointEditableObject(selectedObject)) {
      renderLineEditHandles(selectedObject);
    }
    layer.batchDraw();
    return;
  }
```

Update the cursor logic in the Stage `mousemove` handler:

```ts
      if (obj && !isEndpointEditableObject(obj) && useAnnotation.getState().activeTool !== "eraser") {
        setStageCursor(cursorForAnnotationInteraction("drag"));
        return;
      }
```

- [ ] **Step 6: Adapt line edit handles for two-handle measurements**

In `src/annotation/Stage.tsx`, change function signatures that currently use
`"start" | "control" | "end"` to use `LineEditHandle`.

Update `lineHandleObject`:

```ts
function lineHandleObject(obj: AnnotationObject, handle: LineEditHandle, point: Point): AnnotationObject {
  const objectPoint = lineVisualPointToObjectPoint(obj, point);
  if (handle === "start") return { ...obj, start: objectPoint };
  if (handle === "end") return { ...obj, end: objectPoint };
  return { ...obj, points: [objectPoint.x, objectPoint.y] };
}
```

Update `lineHandlePoint`:

```ts
function lineHandlePoint(obj: AnnotationObject, handle: LineEditHandle): Point {
  if (handle === "start") return linePointWithTransform(obj, obj.start ?? { x: 0, y: 0 });
  if (handle === "end") return linePointWithTransform(obj, obj.end ?? { x: 0, y: 0 });
  return linePointWithTransform(obj, lineControlPoint(obj));
}
```

Update `moveLineEditHandles`:

```ts
function moveLineEditHandles(obj: AnnotationObject, activeHandle?: LineEditHandle) {
  if (!lineEditGroup) return;
  const handles = editableLineHandles(obj);
  handles.forEach((handle) => {
    if (handle === activeHandle) return;
    const node = lineEditGroup?.findOne(`.line-edit-${handle}`) as Konva.Circle | undefined;
    const point = lineHandlePoint(obj, handle);
    node?.position(point);
  });
  const guide = lineEditGroup.findOne(".line-edit-guide") as Konva.Line | undefined;
  const start = lineHandlePoint(obj, "start");
  const end = lineHandlePoint(obj, "end");
  if (handles.includes("control")) {
    const control = lineHandlePoint(obj, "control");
    guide?.points([start.x, start.y, control.x, control.y, end.x, end.y]);
  } else {
    guide?.points([start.x, start.y, end.x, end.y]);
  }
}
```

Update `previewLineHandleDrag`:

```ts
function previewLineHandleDrag(
  obj: AnnotationObject,
  handle: LineEditHandle,
  point: Point,
) {
  const nextObj = lineHandleObject(obj, handle, point);
  const node = findRenderedObjectNode(obj.id);
  if (node instanceof Konva.Group) {
    node.position({
      x: nextObj.start!.x + nextObj.transform.x,
      y: nextObj.start!.y + nextObj.transform.y,
    });
    if (nextObj.type === "measure") updateMeasureObjectNode(node, nextObj);
    else updateLineObjectNode(node, nextObj);
  }
  moveLineEditHandles(nextObj, handle);
  layer?.batchDraw();
}
```

Update `persistLineHandleDrag`:

```ts
function persistLineHandleDrag(
  obj: AnnotationObject,
  handle: LineEditHandle,
  point: Point,
) {
  const objectPoint = lineVisualPointToObjectPoint(obj, point);
  const { resizeObject } = useAnnotation.getState();
  if (handle === "start") resizeObject(obj.id, { start: objectPoint });
  else if (handle === "end") resizeObject(obj.id, { end: objectPoint });
  else resizeObject(obj.id, { points: [objectPoint.x, objectPoint.y] });
}
```

Update `createLineEditHandle`:

```ts
function createLineEditHandle(obj: AnnotationObject, handle: LineEditHandle): Konva.Circle {
```

Update `renderLineEditHandles`:

```ts
function renderLineEditHandles(obj: AnnotationObject) {
  if (!layer) return;
  clearLineEditHandles();
  lineEditGroup = new Konva.Group({ name: EDIT_OVERLAY_NAME });

  const handles = editableLineHandles(obj);
  const start = lineHandlePoint(obj, "start");
  const end = lineHandlePoint(obj, "end");
  const guidePoints = handles.includes("control")
    ? (() => {
        const control = lineHandlePoint(obj, "control");
        return [start.x, start.y, control.x, control.y, end.x, end.y];
      })()
    : [start.x, start.y, end.x, end.y];

  lineEditGroup.add(new Konva.Line({
    points: guidePoints,
    stroke: "#0099ff",
    strokeWidth: 1,
    dash: [4, 4],
    listening: false,
    name: `${EDIT_OVERLAY_NAME} line-edit-guide`,
  }));

  handles.forEach((handle) => {
    lineEditGroup?.add(createLineEditHandle(obj, handle));
  });

  layer.add(lineEditGroup);
  lineEditGroup.moveToTop();
}
```

- [ ] **Step 7: Run render and Stage helper tests to verify they pass**

Run:

```bash
pnpm test -- src/__tests__/annotation-render.test.ts src/__tests__/annotation-stage-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/annotation/render.ts src/annotation/Stage.tsx src/__tests__/annotation-render.test.ts src/__tests__/annotation-stage-helpers.test.ts
git commit -m "feat: integrate measurement annotation editing"
```

---

### Task 4: Add Measure Toolbar And Property Panel Controls

**Files:**
- Modify: `src/annotation/Toolbar.tsx`
- Modify: `src/annotation/PropertyPanel.tsx`
- Modify: `src/__tests__/annotation-toolbar.test.tsx`
- Modify: `src/__tests__/annotation-property-panel.test.tsx`

- [ ] **Step 1: Write failing toolbar tests**

In `src/__tests__/annotation-toolbar.test.tsx`, add `"Measure"` to the tooltip
list in `provides hover tooltips for toolbar operations`:

```ts
      "Measure",
```

Add this test:

```ts
  it("selects the measure tool from the toolbar", () => {
    renderToolbar();

    fireEvent.click(screen.getByTitle("Measure"));

    expect(useAnnotation.getState().activeTool).toBe("measure");
  });
```

- [ ] **Step 2: Write failing property panel tests**

In `src/__tests__/annotation-property-panel.test.tsx`, add this test:

```ts
  it("renders measurement controls without decorative line style choices", () => {
    render(<PropertyPanel tool="measure" />);

    expect(screen.getByTitle("Stroke width")).not.toBeNull();
    expect(screen.getByTitle("#ff0000")).not.toBeNull();
    expect(screen.queryByLabelText("Line style: Solid")).toBeNull();
    expect(screen.queryByLabelText("Arrowhead: Open")).toBeNull();
  });
```

- [ ] **Step 3: Run toolbar and property panel tests to verify they fail**

Run:

```bash
pnpm test -- src/__tests__/annotation-toolbar.test.tsx src/__tests__/annotation-property-panel.test.tsx
```

Expected: FAIL because the toolbar does not render Measure and the property
panel has no measure section.

- [ ] **Step 4: Add the Measure toolbar button**

In `src/annotation/Toolbar.tsx`, add `Ruler` to the lucide import:

```ts
  Ruler,
```

Add Measure after Line in `TOOLS`:

```tsx
  { id: "line", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5" /></svg>, label: "Line" },
  { id: "measure", icon: <Ruler size={18} />, label: "Measure" },
  { id: "arrow", icon: <MoveUpRight size={18} />, label: "Arrow" },
```

- [ ] **Step 5: Add the Measure property panel**

In `src/annotation/PropertyPanel.tsx`, add this section near the existing
`LineSection`:

```tsx
function MeasureSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
    </>
  );
}
```

Render it inside `PropertyPanel`:

```tsx
      {tool === "measure" && <MeasureSection style={style} set={set} />}
```

- [ ] **Step 6: Run toolbar and property panel tests to verify they pass**

Run:

```bash
pnpm test -- src/__tests__/annotation-toolbar.test.tsx src/__tests__/annotation-property-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/annotation/Toolbar.tsx src/annotation/PropertyPanel.tsx src/__tests__/annotation-toolbar.test.tsx src/__tests__/annotation-property-panel.test.tsx
git commit -m "feat: add measurement annotation controls"
```

---

### Task 5: Verify Export Hides Measure Edit Handles

**Files:**
- Modify: `src/__tests__/annotation-export.test.ts`

- [ ] **Step 1: Write export coverage for measurement objects**

In `src/__tests__/annotation-export.test.ts`, add this test:

```ts
  it("exports measurement content while hiding measurement edit overlays", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const toBlob = vi.fn(({ callback }) => callback(blob));
    const overlay = {
      visible: vi.fn((value?: boolean) => value === undefined ? true : undefined),
    };
    useAnnotation.getState().addObject({
      id: "measure-1",
      type: "measure",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });
    vi.mocked(getStage).mockReturnValue({
      toBlob,
      batchDraw: vi.fn(),
      find: vi.fn((selector: string) => selector === ".annotation-edit-overlay" ? [overlay] : []),
    } as unknown as Konva.Stage);
    vi.mocked(getTransformer).mockReturnValue({ visible: vi.fn() } as never);

    await exportAnnotationLayer(2);

    expect(toBlob).toHaveBeenCalledWith(expect.objectContaining({
      pixelRatio: 2,
      mimeType: "image/png",
    }));
    expect(overlay.visible).toHaveBeenCalledWith(false);
    expect(overlay.visible).toHaveBeenLastCalledWith(true);
  });
```

- [ ] **Step 2: Run export tests**

Run:

```bash
pnpm test -- src/__tests__/annotation-export.test.ts
```

Expected: PASS. If it fails because `measure` is missing from the object union,
Task 1 was not applied correctly.

- [ ] **Step 3: Commit Task 5**

```bash
git add src/__tests__/annotation-export.test.ts
git commit -m "test: cover measurement annotation export"
```

---

### Task 6: Final Verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused annotation tests**

Run:

```bash
pnpm test -- src/__tests__/annotation-measure-tool.test.ts src/__tests__/annotation-render.test.ts src/__tests__/annotation-stage-helpers.test.ts src/__tests__/annotation-store.test.ts src/__tests__/annotation-toolbar.test.tsx src/__tests__/annotation-property-panel.test.tsx src/__tests__/annotation-export.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Run full frontend test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended files are changed. If unrelated files appear, leave
them unstaged and mention them in the handoff.

- [ ] **Step 5: Commit any final fixes**

If final verification required small fixes, commit them:

```bash
git add src/annotation src/__tests__
git commit -m "fix: polish measurement annotation behavior"
```

If no fixes were needed, do not create an empty commit.
