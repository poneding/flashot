# Annotation Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add annotation tools (pen, line, rect, ellipse, text, blur, highlight, eraser) to the screenshot overlay so users can mark up captures before copying/saving.

**Architecture:** Konva (imperative API) renders annotations on a Canvas layer positioned over the selection. A Zustand store manages annotation objects and undo/redo via a command stack. On export, the annotation layer is exported as a transparent PNG and sent to Rust for alpha-compositing with the cropped screenshot.

**Tech Stack:** Konva, perfect-freehand, Zustand, React (DOM for toolbar/panels), Tauri IPC, Rust `image` crate for compositing.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/annotation/types.ts` | Annotation type definitions (AnnotationObject, AnnotationStyle, Command, ToolType) |
| Create | `src/annotation/store.ts` | Zustand store: objects, command stack, active tool, active style, selection state |
| Create | `src/annotation/commands.ts` | Command stack logic: execute, undo, redo |
| Create | `src/annotation/Stage.tsx` | Konva Stage container, manages Konva instance lifecycle, pointer event routing |
| Create | `src/annotation/Toolbar.tsx` | Annotation toolbar with tool buttons, undo/redo, copy/save/close |
| Create | `src/annotation/PropertyPanel.tsx` | Secondary popup panel for tool-specific properties |
| Create | `src/annotation/tools/draw.ts` | Pen tool: freehand drawing with perfect-freehand |
| Create | `src/annotation/tools/line.ts` | Line tool: straight/wavy, solid/dotted/dashed, arrows |
| Create | `src/annotation/tools/rect.ts` | Rectangle tool: hollow/solid, corner radius |
| Create | `src/annotation/tools/ellipse.ts` | Ellipse tool: hollow/solid |
| Create | `src/annotation/tools/text.ts` | Text tool: click-to-place, inline editing |
| Create | `src/annotation/tools/blur.ts` | Blur tool: mosaic/gaussian, rect/freehand |
| Create | `src/annotation/tools/highlight.ts` | Highlight tool: semi-transparent freehand/straight |
| Create | `src/annotation/tools/eraser.ts` | Eraser tool: delete objects by intersection |
| Create | `src/annotation/export.ts` | Export annotation layer as PNG blob |
| Create | `src/annotation/TextOverlay.tsx` | HTML textarea overlay for text editing |
| Create | `src/__tests__/annotation-commands.test.ts` | Unit tests for command stack |
| Create | `src/__tests__/annotation-store.test.ts` | Unit tests for annotation store |
| Modify | `src/overlay/state.ts` | Remove toolbar-related concerns from overlay (toolbar now lives in annotation) |
| Modify | `src/routes/Overlay.tsx` | Integrate annotation Stage and Toolbar into render tree |
| Modify | `src/overlay/Toolbar.tsx` | Replace with annotation toolbar (or remove if fully superseded) |
| Modify | `src/lib/ipc.ts` | Update cropAndCopy/cropAndSave to accept optional annotation PNG |
| Modify | `src/lib/types.ts` | Add annotation-related shared types if needed |
| Modify | `src-tauri/src/commands.rs` | Add `annotation_png` parameter, implement alpha-composite |

---

## Task 1: Install Dependencies and Add Font

**Files:**
- Modify: `package.json`
- Create: `public/fonts/Excalifont.woff2`
- Create: `src/styles/fonts.css`

- [ ] **Step 1: Install npm packages**

```bash
pnpm add konva@^10.3.0 perfect-freehand@^1.2.2
```

- [ ] **Step 2: Download Excalifont woff2**

```bash
mkdir -p public/fonts
curl -L -o public/fonts/Excalifont.woff2 "https://github.com/excalidraw/excalidraw/raw/master/packages/excalidraw/fonts/assets/Excalifont-Regular.woff2"
```

- [ ] **Step 3: Create font-face CSS**

Create `src/styles/fonts.css`:

```css
@font-face {
  font-family: "Excalifont";
  src: url("/fonts/Excalifont.woff2") format("woff2");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 4: Import font CSS in main entry**

Add to `src/main.tsx`:

```typescript
import "./styles/fonts.css";
```

- [ ] **Step 5: Verify build succeeds**

```bash
pnpm build
```

Expected: Build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml public/fonts/ src/styles/fonts.css src/main.tsx
git commit -m "chore: add konva, perfect-freehand dependencies and Excalifont"
```

---

## Task 2: Annotation Types and Constants

**Files:**
- Create: `src/annotation/types.ts`

- [ ] **Step 1: Create annotation types file**

Create `src/annotation/types.ts`:

```typescript
import type { Point } from "@/lib/types";

export type AnnotationId = string;

export type ToolType =
  | "select"
  | "draw"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "blur"
  | "highlight"
  | "eraser";

export type LineShape = "straight" | "wavy";
export type LineStyle = "solid" | "dotted" | "dashed";
export type ArrowDirection = "none" | "start" | "end" | "both";
export type ArrowStyle = "v-shape" | "filled-triangle";
export type FillMode = "hollow" | "solid";
export type BlurMode = "mosaic" | "gaussian";
export type BlurMethod = "rect" | "freehand";
export type HighlightMode = "freehand" | "straight";

export type AnnotationStyle = {
  color: string;
  strokeWidth: number;
  lineShape?: LineShape;
  lineStyle?: LineStyle;
  arrow?: ArrowDirection;
  arrowStyle?: ArrowStyle;
  fill?: FillMode;
  cornerRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  blurMode?: BlurMode;
  blurMethod?: BlurMethod;
  blurIntensity?: number;
  highlightMode?: HighlightMode;
  opacity?: number;
};

export type AnnotationObject = {
  id: AnnotationId;
  type: "draw" | "line" | "rect" | "ellipse" | "text" | "blur" | "highlight";
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

export type CommandType = "add" | "delete" | "move" | "resize" | "modify-style";

export type Command = {
  type: CommandType;
  objectId: AnnotationId;
  before: Partial<AnnotationObject>;
  after: Partial<AnnotationObject>;
};

export const PRESET_COLORS = [
  "#ff0000",
  "#ff6600",
  "#ffcc00",
  "#33cc33",
  "#0099ff",
  "#6633ff",
  "#cc00cc",
  "#ffffff",
  "#999999",
  "#000000",
];

export const STROKE_WIDTHS = [2, 4, 6, 8, 12];

export const FONT_SIZES = [14, 18, 24, 32, 48];

export const DEFAULT_STYLE: AnnotationStyle = {
  color: "#ff0000",
  strokeWidth: 4,
  lineShape: "straight",
  lineStyle: "solid",
  arrow: "none",
  arrowStyle: "v-shape",
  fill: "hollow",
  cornerRadius: 0,
  fontFamily: "Excalifont",
  fontSize: 24,
  blurMode: "mosaic",
  blurMethod: "rect",
  blurIntensity: 10,
  highlightMode: "freehand",
  opacity: 0.35,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/annotation/types.ts
git commit -m "feat: add annotation type definitions and constants"
```

---

## Task 3: Command Stack (Undo/Redo)

**Files:**
- Create: `src/annotation/commands.ts`
- Create: `src/__tests__/annotation-commands.test.ts`

- [ ] **Step 1: Write failing tests for command stack**

Create `src/__tests__/annotation-commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createCommandStack } from "@/annotation/commands";
import type { AnnotationObject, Command } from "@/annotation/types";

const makeObject = (id: string): AnnotationObject => ({
  id,
  type: "rect",
  start: { x: 0, y: 0 },
  end: { x: 100, y: 100 },
  style: { color: "#ff0000", strokeWidth: 4 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
});

describe("createCommandStack", () => {
  it("executes an add command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = {
      type: "add",
      objectId: "1",
      before: {},
      after: obj,
    };
    const objects = stack.execute(cmd, []);
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe("1");
  });

  it("undoes an add command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    const objects = stack.undo([obj]);
    expect(objects).toHaveLength(0);
  });

  it("redoes after undo", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    stack.undo([obj]);
    const objects = stack.redo([]);
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe("1");
  });

  it("executes a move command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = {
      type: "move",
      objectId: "1",
      before: { transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } },
      after: { transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 } },
    };
    const objects = stack.execute(cmd, [obj]);
    expect(objects[0].transform.x).toBe(50);
    expect(objects[0].transform.y).toBe(50);
  });

  it("executes a delete command", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    const cmd: Command = {
      type: "delete",
      objectId: "1",
      before: obj,
      after: {},
    };
    const objects = stack.execute(cmd, [obj]);
    expect(objects).toHaveLength(0);
  });

  it("clears redo stack on new command after undo", () => {
    const stack = createCommandStack();
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    stack.undo([obj]);
    expect(stack.canRedo()).toBe(true);
    const obj2 = makeObject("2");
    stack.execute({ type: "add", objectId: "2", before: {}, after: obj2 }, []);
    expect(stack.canRedo()).toBe(false);
  });

  it("canUndo/canRedo report correctly", () => {
    const stack = createCommandStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    const obj = makeObject("1");
    stack.execute({ type: "add", objectId: "1", before: {}, after: obj }, []);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- src/__tests__/annotation-commands.test.ts
```

Expected: FAIL — module `@/annotation/commands` not found.

- [ ] **Step 3: Implement command stack**

Create `src/annotation/commands.ts`:

```typescript
import type { AnnotationObject, Command } from "@/annotation/types";

export interface CommandStack {
  execute(cmd: Command, objects: AnnotationObject[]): AnnotationObject[];
  undo(objects: AnnotationObject[]): AnnotationObject[];
  redo(objects: AnnotationObject[]): AnnotationObject[];
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createCommandStack(): CommandStack {
  const history: Command[] = [];
  let index = -1;

  function applyCommand(
    cmd: Command,
    objects: AnnotationObject[],
    direction: "forward" | "backward"
  ): AnnotationObject[] {
    const { type, objectId } = cmd;
    const patch = direction === "forward" ? cmd.after : cmd.before;

    if (type === "add") {
      if (direction === "forward") {
        return [...objects, patch as AnnotationObject];
      }
      return objects.filter((o) => o.id !== objectId);
    }

    if (type === "delete") {
      if (direction === "forward") {
        return objects.filter((o) => o.id !== objectId);
      }
      return [...objects, cmd.before as AnnotationObject];
    }

    return objects.map((o) =>
      o.id === objectId ? { ...o, ...patch } : o
    );
  }

  return {
    execute(cmd, objects) {
      history.splice(index + 1);
      history.push(cmd);
      index++;
      return applyCommand(cmd, objects, "forward");
    },
    undo(objects) {
      if (index < 0) return objects;
      const cmd = history[index];
      index--;
      return applyCommand(cmd, objects, "backward");
    },
    redo(objects) {
      if (index >= history.length - 1) return objects;
      index++;
      const cmd = history[index];
      return applyCommand(cmd, objects, "forward");
    },
    canUndo() {
      return index >= 0;
    },
    canRedo() {
      return index < history.length - 1;
    },
    clear() {
      history.length = 0;
      index = -1;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- src/__tests__/annotation-commands.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/annotation/commands.ts src/__tests__/annotation-commands.test.ts
git commit -m "feat: implement undo/redo command stack with tests"
```

---

## Task 4: Annotation Zustand Store

**Files:**
- Create: `src/annotation/store.ts`
- Create: `src/__tests__/annotation-store.test.ts`

- [ ] **Step 1: Write failing tests for annotation store**

Create `src/__tests__/annotation-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useAnnotation } from "@/annotation/store";

describe("useAnnotation store", () => {
  beforeEach(() => {
    useAnnotation.getState().reset();
  });

  it("initializes with default state", () => {
    const state = useAnnotation.getState();
    expect(state.objects).toEqual([]);
    expect(state.activeTool).toBe("select");
    expect(state.selectedObjectId).toBeNull();
    expect(state.drawingState).toBe("idle");
  });

  it("sets active tool", () => {
    useAnnotation.getState().setActiveTool("rect");
    expect(useAnnotation.getState().activeTool).toBe("rect");
    expect(useAnnotation.getState().selectedObjectId).toBeNull();
  });

  it("adds an object via addObject", () => {
    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    expect(useAnnotation.getState().objects).toHaveLength(1);
    expect(useAnnotation.getState().canUndo).toBe(true);
  });

  it("undo removes the added object", () => {
    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().undo();
    expect(useAnnotation.getState().objects).toHaveLength(0);
    expect(useAnnotation.getState().canRedo).toBe(true);
  });

  it("deleteObject removes and records command", () => {
    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().deleteObject("1");
    expect(useAnnotation.getState().objects).toHaveLength(0);
    useAnnotation.getState().undo();
    expect(useAnnotation.getState().objects).toHaveLength(1);
  });

  it("moveObject updates transform", () => {
    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().moveObject("1", { x: 50, y: 30, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(useAnnotation.getState().objects[0].transform.x).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- src/__tests__/annotation-store.test.ts
```

Expected: FAIL — module `@/annotation/store` not found.

- [ ] **Step 3: Implement annotation store**

Create `src/annotation/store.ts`:

```typescript
import { create } from "zustand";
import { createCommandStack, type CommandStack } from "@/annotation/commands";
import {
  DEFAULT_STYLE,
  type AnnotationId,
  type AnnotationObject,
  type AnnotationStyle,
  type Command,
  type ToolType,
} from "@/annotation/types";

type DrawingState = "idle" | "active";

type AnnotationState = {
  objects: AnnotationObject[];
  activeTool: ToolType;
  activeStyle: AnnotationStyle;
  selectedObjectId: AnnotationId | null;
  drawingState: DrawingState;
  canUndo: boolean;
  canRedo: boolean;
};

type AnnotationActions = {
  setActiveTool: (tool: ToolType) => void;
  setActiveStyle: (style: Partial<AnnotationStyle>) => void;
  setDrawingState: (state: DrawingState) => void;
  setSelectedObject: (id: AnnotationId | null) => void;
  addObject: (obj: AnnotationObject) => void;
  deleteObject: (id: AnnotationId) => void;
  moveObject: (id: AnnotationId, transform: AnnotationObject["transform"]) => void;
  resizeObject: (id: AnnotationId, updates: Partial<AnnotationObject>) => void;
  modifyStyle: (id: AnnotationId, style: Partial<AnnotationStyle>) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

let commandStack: CommandStack = createCommandStack();

const initialState: AnnotationState = {
  objects: [],
  activeTool: "select",
  activeStyle: { ...DEFAULT_STYLE },
  selectedObjectId: null,
  drawingState: "idle",
  canUndo: false,
  canRedo: false,
};

export const useAnnotation = create<AnnotationState & AnnotationActions>((set, get) => ({
  ...initialState,

  setActiveTool(tool) {
    set({ activeTool: tool, selectedObjectId: null });
  },

  setActiveStyle(partial) {
    set({ activeStyle: { ...get().activeStyle, ...partial } });
  },

  setDrawingState(drawingState) {
    set({ drawingState });
  },

  setSelectedObject(id) {
    set({ selectedObjectId: id });
  },

  addObject(obj) {
    const cmd: Command = { type: "add", objectId: obj.id, before: {}, after: obj };
    const objects = commandStack.execute(cmd, get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  deleteObject(id) {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    const cmd: Command = { type: "delete", objectId: id, before: obj, after: {} };
    const objects = commandStack.execute(cmd, get().objects);
    set({
      objects,
      selectedObjectId: get().selectedObjectId === id ? null : get().selectedObjectId,
      canUndo: commandStack.canUndo(),
      canRedo: commandStack.canRedo(),
    });
  },

  moveObject(id, transform) {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    const cmd: Command = {
      type: "move",
      objectId: id,
      before: { transform: { ...obj.transform } },
      after: { transform },
    };
    const objects = commandStack.execute(cmd, get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  resizeObject(id, updates) {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    const before: Partial<AnnotationObject> = {};
    const after: Partial<AnnotationObject> = {};
    if (updates.start) { before.start = obj.start; after.start = updates.start; }
    if (updates.end) { before.end = obj.end; after.end = updates.end; }
    if (updates.points) { before.points = obj.points; after.points = updates.points; }
    if (updates.transform) { before.transform = { ...obj.transform }; after.transform = updates.transform; }
    const cmd: Command = { type: "resize", objectId: id, before, after };
    const objects = commandStack.execute(cmd, get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  modifyStyle(id, style) {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    const cmd: Command = {
      type: "modify-style",
      objectId: id,
      before: { style: { ...obj.style } },
      after: { style: { ...obj.style, ...style } },
    };
    const objects = commandStack.execute(cmd, get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  undo() {
    const objects = commandStack.undo(get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  redo() {
    const objects = commandStack.redo(get().objects);
    set({ objects, canUndo: commandStack.canUndo(), canRedo: commandStack.canRedo() });
  },

  reset() {
    commandStack = createCommandStack();
    set({ ...initialState });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- src/__tests__/annotation-store.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/annotation/store.ts src/__tests__/annotation-store.test.ts
git commit -m "feat: implement annotation Zustand store with undo/redo"
```

---

## Task 5: Konva Stage Container

**Files:**
- Create: `src/annotation/Stage.tsx`

- [ ] **Step 1: Create Stage component**

Create `src/annotation/Stage.tsx`:

```typescript
import { useEffect, useRef } from "react";
import Konva from "konva";
import type { Rect } from "@/lib/types";
import { useAnnotation } from "@/annotation/store";

type Props = {
  selection: Rect;
  scaleFactor: number;
};

let stage: Konva.Stage | null = null;
let layer: Konva.Layer | null = null;
let transformer: Konva.Transformer | null = null;

export function getStage(): Konva.Stage | null {
  return stage;
}

export function getLayer(): Konva.Layer | null {
  return layer;
}

export function getTransformer(): Konva.Transformer | null {
  return transformer;
}

export function AnnotationStage({ selection, scaleFactor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTool = useAnnotation((s) => s.activeTool);

  useEffect(() => {
    if (!containerRef.current) return;

    stage = new Konva.Stage({
      container: containerRef.current,
      width: selection.width,
      height: selection.height,
    });

    layer = new Konva.Layer();
    stage.add(layer);

    transformer = new Konva.Transformer({
      rotateEnabled: true,
      borderStroke: "#0099ff",
      anchorStroke: "#0099ff",
      anchorFill: "#ffffff",
      anchorSize: 8,
    });
    layer.add(transformer);

    return () => {
      stage?.destroy();
      stage = null;
      layer = null;
      transformer = null;
    };
  }, []);

  useEffect(() => {
    if (!stage) return;
    stage.width(selection.width);
    stage.height(selection.height);
    stage.batchDraw();
  }, [selection.width, selection.height]);

  const cursor =
    activeTool === "select"
      ? "default"
      : activeTool === "text"
        ? "text"
        : "crosshair";

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: selection.x,
        top: selection.y,
        width: selection.width,
        height: selection.height,
        cursor,
        pointerEvents: "auto",
      }}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/annotation/Stage.tsx
git commit -m "feat: add Konva Stage container component"
```

---

## Task 6: Annotation Toolbar

**Files:**
- Create: `src/annotation/Toolbar.tsx`
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Create annotation toolbar**

Create `src/annotation/Toolbar.tsx`:

```typescript
import { useState, type CSSProperties } from "react";
import {
  MousePointer2,
  Pencil,
  Minus,
  Square,
  Circle,
  Type,
  Droplets,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Copy,
  Save,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { computeToolbarPosition } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import { useAnnotation } from "@/annotation/store";
import type { ToolType } from "@/annotation/types";
import { PropertyPanel } from "@/annotation/PropertyPanel";

type ToolDef = { id: ToolType; icon: LucideIcon; label: string };

const TOOLS: ToolDef[] = [
  { id: "select", icon: MousePointer2, label: "Select" },
  { id: "draw", icon: Pencil, label: "Pen" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "ellipse", icon: Circle, label: "Ellipse" },
  { id: "text", icon: Type, label: "Text" },
  { id: "blur", icon: Droplets, label: "Blur" },
  { id: "highlight", icon: Highlighter, label: "Highlight" },
  { id: "eraser", icon: Eraser, label: "Eraser" },
];

const TB = { width: 460, height: 40 };

type Props = {
  selection: Rect;
  monitorRect: Rect;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function AnnotationToolbar({ selection, monitorRect, onCopy, onSave, onClose }: Props) {
  const activeTool = useAnnotation((s) => s.activeTool);
  const setActiveTool = useAnnotation((s) => s.setActiveTool);
  const canUndo = useAnnotation((s) => s.canUndo);
  const canRedo = useAnnotation((s) => s.canRedo);
  const undo = useAnnotation((s) => s.undo);
  const redo = useAnnotation((s) => s.redo);
  const [showPanel, setShowPanel] = useState(false);

  const pos = computeToolbarPosition(selection, TB, monitorRect);

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: pos.x,
    top: pos.y,
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "4px 8px",
    borderRadius: 10,
    background: "rgba(30, 30, 30, 0.85)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    pointerEvents: "auto",
    zIndex: 9999,
  };

  const handleToolClick = (tool: ToolType) => {
    if (tool === activeTool && tool !== "select") {
      setShowPanel(!showPanel);
    } else {
      setActiveTool(tool);
      setShowPanel(tool !== "select" && tool !== "eraser");
    }
  };

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      {showPanel && activeTool !== "select" && activeTool !== "eraser" && (
        <PropertyPanel
          tool={activeTool}
          style={{ position: "absolute", left: pos.x, top: pos.y - 52 }}
        />
      )}
      <div style={containerStyle}>
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            active={activeTool === t.id}
            onClick={() => handleToolClick(t.id)}
          />
        ))}
        <Separator />
        <ActionButton icon={Undo2} label="Undo" onClick={undo} disabled={!canUndo} />
        <ActionButton icon={Redo2} label="Redo" onClick={redo} disabled={!canRedo} />
        <Separator />
        <ActionButton icon={Copy} label="Copy" onClick={onCopy} variant="primary" />
        <ActionButton icon={Save} label="Save" onClick={onSave} />
        <ActionButton icon={X} label="Close" onClick={onClose} />
      </div>
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    background: active ? "rgba(255,255,255,0.15)" : "transparent",
    color: active ? "#ffffff" : "rgba(255,255,255,0.7)",
    position: "relative",
  };

  return (
    <button style={style} onClick={onClick} title={label}>
      <Icon size={18} />
      {active && (
        <span
          style={{
            position: "absolute",
            bottom: 2,
            left: "50%",
            transform: "translateX(-50%)",
            width: 12,
            height: 2,
            borderRadius: 1,
            background: "#0099ff",
          }}
        />
      )}
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary";
}) {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 6,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: variant === "primary" ? "rgba(0,153,255,0.8)" : "transparent",
    color: disabled ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)",
    opacity: disabled ? 0.5 : 1,
  };

  return (
    <button style={style} onClick={onClick} disabled={disabled} title={label}>
      <Icon size={18} />
    </button>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "rgba(255,255,255,0.15)",
        margin: "0 4px",
      }}
    />
  );
}
```

- [ ] **Step 2: Create placeholder PropertyPanel**

Create `src/annotation/PropertyPanel.tsx`:

```typescript
import type { CSSProperties } from "react";
import type { ToolType } from "@/annotation/types";

type Props = {
  tool: ToolType;
  style?: CSSProperties;
};

export function PropertyPanel({ tool, style }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 8,
        background: "rgba(30, 30, 30, 0.85)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.8)",
        fontSize: 12,
        ...style,
      }}
    >
      <span>{tool} properties (TODO)</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm lint
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/annotation/Toolbar.tsx src/annotation/PropertyPanel.tsx
git commit -m "feat: add annotation toolbar with tool buttons and actions"
```

---

## Task 7: Integrate Annotation into Overlay

**Files:**
- Modify: `src/routes/Overlay.tsx`
- Modify: `src/overlay/Toolbar.tsx` (remove or keep as fallback)

- [ ] **Step 1: Update Overlay.tsx to render annotation components**

In `src/routes/Overlay.tsx`, add imports and render `AnnotationStage` and `AnnotationToolbar` when in `committed` mode. Replace the existing `<Toolbar />` with `<AnnotationToolbar />`.

Add imports:

```typescript
import { AnnotationStage } from "@/annotation/Stage";
import { AnnotationToolbar } from "@/annotation/Toolbar";
import { useAnnotation } from "@/annotation/store";
import { cropAndCopy, cropAndSave, cancelCapture } from "@/lib/ipc";
```

In the render tree, replace `<Toolbar />` with:

```tsx
{mode === "committed" && selection && monitorRect && monitorId !== null && (
  <>
    <AnnotationStage selection={selection} scaleFactor={scaleFactor} />
    <AnnotationToolbar
      selection={selection}
      monitorRect={localMonitorBounds}
      onCopy={handleCopy}
      onSave={handleSave}
      onClose={handleClose}
    />
  </>
)}
```

Add handler functions:

```typescript
const handleCopy = async () => {
  if (monitorId === null || !selection) return;
  await cropAndCopy(monitorId, selection);
};

const handleSave = async () => {
  if (monitorId === null || !selection) return;
  await cropAndSave(monitorId, selection);
};

const handleClose = () => {
  cancelCapture();
};
```

- [ ] **Step 2: Add keyboard shortcuts for undo/redo/delete**

In the existing keyboard handler in `Overlay.tsx`, add annotation shortcuts:

```typescript
// Inside the keydown handler, after existing Escape/Cmd+C handling:
const { undo, redo, deleteObject, selectedObjectId } = useAnnotation.getState();

if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
  e.preventDefault();
  undo();
  return;
}
if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
  e.preventDefault();
  redo();
  return;
}
if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectId) {
  e.preventDefault();
  deleteObject(selectedObjectId);
  return;
}
```

- [ ] **Step 3: Reset annotation store on capture end**

In the `capture:end` event listener, call `useAnnotation.getState().reset()`:

```typescript
// In the onCaptureEnd callback:
useAnnotation.getState().reset();
```

- [ ] **Step 4: Verify build succeeds**

```bash
pnpm build
```

Expected: Build completes. The app should show the annotation toolbar when a selection is committed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/Overlay.tsx
git commit -m "feat: integrate annotation stage and toolbar into overlay"
```

---

## Task 8: Pen Tool (Freehand Drawing)

**Files:**
- Create: `src/annotation/tools/draw.ts`

- [ ] **Step 1: Implement pen tool**

Create `src/annotation/tools/draw.ts`:

```typescript
import Konva from "konva";
import getStroke from "perfect-freehand";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentPoints: number[][] = [];
let currentPath: Konva.Path | null = null;

function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length < 2) return "";
  const d = [`M ${stroke[0][0]} ${stroke[0][1]}`];
  for (let i = 1; i < stroke.length; i++) {
    const [x, y] = stroke[i];
    d.push(`L ${x} ${y}`);
  }
  d.push("Z");
  return d.join(" ");
}

function renderStroke(points: number[][], style: AnnotationStyle): string {
  const stroke = getStroke(points, {
    size: style.strokeWidth * 2,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  });
  return getSvgPathFromStroke(stroke);
}

export function onDrawStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  currentPoints = [[x, y, 0.5]];

  currentPath = new Konva.Path({
    data: "",
    fill: activeStyle.color,
    listening: false,
  });
  layer.add(currentPath);
  currentPath.moveToTop();
}

export function onDrawMove(x: number, y: number) {
  if (!currentPath) return;

  const { activeStyle } = useAnnotation.getState();
  currentPoints.push([x, y, 0.5]);
  const pathData = renderStroke(currentPoints, activeStyle);
  currentPath.data(pathData);
  getLayer()?.batchDraw();
}

export function onDrawEnd(): AnnotationObject | null {
  if (!currentPath || currentPoints.length < 2) {
    currentPath?.destroy();
    currentPath = null;
    currentPoints = [];
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();
  const flatPoints = currentPoints.flat();

  const obj: AnnotationObject = {
    id,
    type: "draw",
    points: flatPoints,
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentPath.id(id);
  currentPath.listening(true);
  currentPath = null;
  currentPoints = [];

  return obj;
}

export function renderDrawObject(obj: AnnotationObject): Konva.Path {
  const points: number[][] = [];
  for (let i = 0; i < (obj.points?.length ?? 0); i += 3) {
    points.push([obj.points![i], obj.points![i + 1], obj.points![i + 2]]);
  }
  const pathData = renderStroke(points, obj.style);
  return new Konva.Path({
    id: obj.id,
    data: pathData,
    fill: obj.style.color,
    ...obj.transform,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/annotation/tools/draw.ts
git commit -m "feat: implement pen tool with perfect-freehand"
```

---

## Task 9: Rectangle and Ellipse Tools

**Files:**
- Create: `src/annotation/tools/rect.ts`
- Create: `src/annotation/tools/ellipse.ts`

- [ ] **Step 1: Implement rectangle tool**

Create `src/annotation/tools/rect.ts`:

```typescript
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let currentRect: Konva.Rect | null = null;
let startX = 0;
let startY = 0;

export function onRectStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  currentRect = new Konva.Rect({
    x,
    y,
    width: 0,
    height: 0,
    stroke: activeStyle.fill === "solid" ? undefined : activeStyle.color,
    strokeWidth: activeStyle.fill === "solid" ? 0 : activeStyle.strokeWidth,
    fill: activeStyle.fill === "solid" ? activeStyle.color : undefined,
    cornerRadius: activeStyle.cornerRadius ?? 0,
    listening: false,
  });
  layer.add(currentRect);
}

export function onRectMove(x: number, y: number) {
  if (!currentRect) return;
  const width = x - startX;
  const height = y - startY;
  currentRect.x(width < 0 ? x : startX);
  currentRect.y(height < 0 ? y : startY);
  currentRect.width(Math.abs(width));
  currentRect.height(Math.abs(height));
  getLayer()?.batchDraw();
}

export function onRectEnd(x: number, y: number): AnnotationObject | null {
  if (!currentRect || (Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4)) {
    currentRect?.destroy();
    currentRect = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();
  currentRect.id(id);
  currentRect.listening(true);

  const obj: AnnotationObject = {
    id,
    type: "rect",
    start: { x: Math.min(startX, x), y: Math.min(startY, y) },
    end: { x: Math.max(startX, x), y: Math.max(startY, y) },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentRect = null;
  return obj;
}

export function renderRectObject(obj: AnnotationObject): Konva.Rect {
  const x = Math.min(obj.start!.x, obj.end!.x);
  const y = Math.min(obj.start!.y, obj.end!.y);
  const width = Math.abs(obj.end!.x - obj.start!.x);
  const height = Math.abs(obj.end!.y - obj.start!.y);

  return new Konva.Rect({
    id: obj.id,
    x: x + obj.transform.x,
    y: y + obj.transform.y,
    width,
    height,
    stroke: obj.style.fill === "solid" ? undefined : obj.style.color,
    strokeWidth: obj.style.fill === "solid" ? 0 : obj.style.strokeWidth,
    fill: obj.style.fill === "solid" ? obj.style.color : undefined,
    cornerRadius: obj.style.cornerRadius ?? 0,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    rotation: obj.transform.rotation,
  });
}
```

- [ ] **Step 2: Implement ellipse tool**

Create `src/annotation/tools/ellipse.ts`:

```typescript
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let currentEllipse: Konva.Ellipse | null = null;
let startX = 0;
let startY = 0;

export function onEllipseStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  currentEllipse = new Konva.Ellipse({
    x,
    y,
    radiusX: 0,
    radiusY: 0,
    stroke: activeStyle.fill === "solid" ? undefined : activeStyle.color,
    strokeWidth: activeStyle.fill === "solid" ? 0 : activeStyle.strokeWidth,
    fill: activeStyle.fill === "solid" ? activeStyle.color : undefined,
    listening: false,
  });
  layer.add(currentEllipse);
}

export function onEllipseMove(x: number, y: number) {
  if (!currentEllipse) return;
  const cx = (startX + x) / 2;
  const cy = (startY + y) / 2;
  currentEllipse.x(cx);
  currentEllipse.y(cy);
  currentEllipse.radiusX(Math.abs(x - startX) / 2);
  currentEllipse.radiusY(Math.abs(y - startY) / 2);
  getLayer()?.batchDraw();
}

export function onEllipseEnd(x: number, y: number): AnnotationObject | null {
  if (!currentEllipse || (Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4)) {
    currentEllipse?.destroy();
    currentEllipse = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();
  currentEllipse.id(id);
  currentEllipse.listening(true);

  const obj: AnnotationObject = {
    id,
    type: "ellipse",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentEllipse = null;
  return obj;
}

export function renderEllipseObject(obj: AnnotationObject): Konva.Ellipse {
  const cx = (obj.start!.x + obj.end!.x) / 2;
  const cy = (obj.start!.y + obj.end!.y) / 2;
  const rx = Math.abs(obj.end!.x - obj.start!.x) / 2;
  const ry = Math.abs(obj.end!.y - obj.start!.y) / 2;

  return new Konva.Ellipse({
    id: obj.id,
    x: cx + obj.transform.x,
    y: cy + obj.transform.y,
    radiusX: rx,
    radiusY: ry,
    stroke: obj.style.fill === "solid" ? undefined : obj.style.color,
    strokeWidth: obj.style.fill === "solid" ? 0 : obj.style.strokeWidth,
    fill: obj.style.fill === "solid" ? obj.style.color : undefined,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    rotation: obj.transform.rotation,
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/annotation/tools/rect.ts src/annotation/tools/ellipse.ts
git commit -m "feat: implement rectangle and ellipse annotation tools"
```

---

## Task 10: Line Tool

**Files:**
- Create: `src/annotation/tools/line.ts`

- [ ] **Step 1: Implement line tool with all variants**

Create `src/annotation/tools/line.ts`:

```typescript
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject, AnnotationStyle } from "@/annotation/types";

let currentGroup: Konva.Group | null = null;
let startX = 0;
let startY = 0;

function generateWavyPoints(x1: number, y1: number, x2: number, y2: number): number[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const segments = Math.max(Math.round(length / 12), 4);
  const amplitude = 6;
  const angle = Math.atan2(dy, dx);
  const points: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const baseX = x1 + dx * t;
    const baseY = y1 + dy * t;
    const offset = Math.sin(t * Math.PI * 2 * (segments / 4)) * amplitude;
    points.push(baseX + Math.cos(angle + Math.PI / 2) * offset);
    points.push(baseY + Math.sin(angle + Math.PI / 2) * offset);
  }
  return points;
}

function createArrowHead(
  x: number,
  y: number,
  angle: number,
  style: AnnotationStyle
): Konva.Shape {
  const size = style.strokeWidth * 3;

  if (style.arrowStyle === "filled-triangle") {
    return new Konva.RegularPolygon({
      x,
      y,
      sides: 3,
      radius: size,
      fill: style.color,
      rotation: (angle * 180) / Math.PI + 90,
    });
  }

  // V-shape arrow
  const p1x = x - size * Math.cos(angle - Math.PI / 6);
  const p1y = y - size * Math.sin(angle - Math.PI / 6);
  const p2x = x - size * Math.cos(angle + Math.PI / 6);
  const p2y = y - size * Math.sin(angle + Math.PI / 6);

  return new Konva.Line({
    points: [p1x, p1y, x, y, p2x, p2y],
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    lineJoin: "round",
  });
}

function getDashPattern(style: AnnotationStyle): number[] | undefined {
  if (style.lineStyle === "dotted") return [2, style.strokeWidth * 2];
  if (style.lineStyle === "dashed") return [style.strokeWidth * 3, style.strokeWidth * 2];
  return undefined;
}

export function onLineStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  startX = x;
  startY = y;
  const { activeStyle } = useAnnotation.getState();

  currentGroup = new Konva.Group({ listening: false });

  const line = new Konva.Line({
    points: [x, y, x, y],
    stroke: activeStyle.color,
    strokeWidth: activeStyle.strokeWidth,
    lineCap: "round",
    dash: getDashPattern(activeStyle),
    name: "main-line",
  });
  currentGroup.add(line);
  layer.add(currentGroup);
}

export function onLineMove(x: number, y: number) {
  if (!currentGroup) return;
  const { activeStyle } = useAnnotation.getState();
  const mainLine = currentGroup.findOne(".main-line") as Konva.Line;
  if (!mainLine) return;

  if (activeStyle.lineShape === "wavy") {
    const wavyPoints = generateWavyPoints(startX, startY, x, y);
    mainLine.points(wavyPoints);
  } else {
    mainLine.points([startX, startY, x, y]);
  }
  mainLine.dash(getDashPattern(activeStyle) ?? []);
  getLayer()?.batchDraw();
}

export function onLineEnd(x: number, y: number): AnnotationObject | null {
  if (!currentGroup || (Math.abs(x - startX) < 4 && Math.abs(y - startY) < 4)) {
    currentGroup?.destroy();
    currentGroup = null;
    return null;
  }

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  // Add arrow heads
  const angle = Math.atan2(y - startY, x - startX);
  if (activeStyle.arrow === "end" || activeStyle.arrow === "both") {
    currentGroup.add(createArrowHead(x, y, angle, activeStyle));
  }
  if (activeStyle.arrow === "start" || activeStyle.arrow === "both") {
    currentGroup.add(createArrowHead(startX, startY, angle + Math.PI, activeStyle));
  }

  currentGroup.id(id);
  currentGroup.listening(true);

  const obj: AnnotationObject = {
    id,
    type: "line",
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentGroup = null;
  return obj;
}

export function renderLineObject(obj: AnnotationObject): Konva.Group {
  const group = new Konva.Group({
    id: obj.id,
    ...obj.transform,
  });

  const { start, end, style } = obj;
  const x1 = start!.x, y1 = start!.y, x2 = end!.x, y2 = end!.y;

  let points: number[];
  if (style.lineShape === "wavy") {
    points = generateWavyPoints(x1, y1, x2, y2);
  } else {
    points = [x1, y1, x2, y2];
  }

  const line = new Konva.Line({
    points,
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    lineCap: "round",
    dash: getDashPattern(style),
    name: "main-line",
  });
  group.add(line);

  const angle = Math.atan2(y2 - y1, x2 - x1);
  if (style.arrow === "end" || style.arrow === "both") {
    group.add(createArrowHead(x2, y2, angle, style));
  }
  if (style.arrow === "start" || style.arrow === "both") {
    group.add(createArrowHead(x1, y1, angle + Math.PI, style));
  }

  return group;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/annotation/tools/line.ts
git commit -m "feat: implement line tool with wavy, dash, and arrow variants"
```

---

## Task 11: Text Tool

**Files:**
- Create: `src/annotation/tools/text.ts`
- Create: `src/annotation/TextOverlay.tsx`

- [ ] **Step 1: Implement text tool logic**

Create `src/annotation/tools/text.ts`:

```typescript
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import type { AnnotationObject } from "@/annotation/types";

export function renderTextObject(obj: AnnotationObject): Konva.Text {
  return new Konva.Text({
    id: obj.id,
    x: obj.start!.x + obj.transform.x,
    y: obj.start!.y + obj.transform.y,
    text: obj.text ?? "",
    fontSize: obj.style.fontSize ?? 24,
    fontFamily: obj.style.fontFamily ?? "Excalifont",
    fill: obj.style.color,
    scaleX: obj.transform.scaleX,
    scaleY: obj.transform.scaleY,
    rotation: obj.transform.rotation,
  });
}

export function addTextToLayer(obj: AnnotationObject) {
  const layer = getLayer();
  if (!layer) return;
  const node = renderTextObject(obj);
  layer.add(node);
  layer.batchDraw();
}
```

- [ ] **Step 2: Implement TextOverlay component**

Create `src/annotation/TextOverlay.tsx`:

```typescript
import { useEffect, useRef, type CSSProperties } from "react";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";

type Props = {
  position: { x: number; y: number };
  selection: Rect;
  onConfirm: (obj: AnnotationObject) => void;
  onCancel: () => void;
  editingObject?: AnnotationObject | null;
};

export function TextOverlay({ position, selection, onConfirm, onCancel, editingObject }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeStyle } = useAnnotation.getState();

  const style = editingObject?.style ?? activeStyle;
  const initialText = editingObject?.text ?? "";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.value = initialText;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
    }
  };

  const handleBlur = () => {
    confirm();
  };

  const confirm = () => {
    const text = textareaRef.current?.value?.trim();
    if (!text) {
      onCancel();
      return;
    }

    const obj: AnnotationObject = {
      id: editingObject?.id ?? crypto.randomUUID(),
      type: "text",
      start: { x: position.x - selection.x, y: position.y - selection.y },
      text,
      style: { ...style },
      transform: editingObject?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    onConfirm(obj);
  };

  const containerStyle: CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    zIndex: 10000,
    pointerEvents: "auto",
  };

  const textareaStyle: CSSProperties = {
    minWidth: 100,
    minHeight: style.fontSize ?? 24,
    padding: 4,
    border: "2px solid #0099ff",
    borderRadius: 4,
    background: "transparent",
    color: style.color,
    fontSize: style.fontSize ?? 24,
    fontFamily: style.fontFamily ?? "Excalifont",
    lineHeight: 1.4,
    outline: "none",
    resize: "none",
    overflow: "hidden",
  };

  return (
    <div style={containerStyle} onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        style={textareaStyle}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/annotation/tools/text.ts src/annotation/TextOverlay.tsx
git commit -m "feat: implement text annotation tool with inline editing"
```

---

## Task 12: Highlight Tool

**Files:**
- Create: `src/annotation/tools/highlight.ts`

- [ ] **Step 1: Implement highlight tool**

Create `src/annotation/tools/highlight.ts`:

```typescript
import Konva from "konva";
import { getLayer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let currentLine: Konva.Line | null = null;
let currentPoints: number[] = [];
let startX = 0;
let startY = 0;

export function onHighlightStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;
  currentPoints = [x, y];

  currentLine = new Konva.Line({
    points: currentPoints,
    stroke: activeStyle.color,
    strokeWidth: activeStyle.strokeWidth * 4,
    opacity: activeStyle.opacity ?? 0.35,
    lineCap: "round",
    lineJoin: "round",
    globalCompositeOperation: "multiply",
    listening: false,
  });
  layer.add(currentLine);
}

export function onHighlightMove(x: number, y: number) {
  if (!currentLine) return;
  const { activeStyle } = useAnnotation.getState();

  if (activeStyle.highlightMode === "straight") {
    currentLine.points([startX, startY, x, y]);
  } else {
    currentPoints.push(x, y);
    currentLine.points([...currentPoints]);
  }
  getLayer()?.batchDraw();
}

export function onHighlightEnd(x: number, y: number): AnnotationObject | null {
  if (!currentLine) return null;

  const { activeStyle } = useAnnotation.getState();
  const id = crypto.randomUUID();

  let points: number[];
  if (activeStyle.highlightMode === "straight") {
    points = [startX, startY, x, y];
  } else {
    points = [...currentPoints];
  }

  if (points.length < 4) {
    currentLine.destroy();
    currentLine = null;
    currentPoints = [];
    return null;
  }

  currentLine.id(id);
  currentLine.listening(true);

  const obj: AnnotationObject = {
    id,
    type: "highlight",
    points,
    start: { x: startX, y: startY },
    end: { x, y },
    style: { ...activeStyle },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  };

  currentLine = null;
  currentPoints = [];
  return obj;
}

export function renderHighlightObject(obj: AnnotationObject): Konva.Line {
  return new Konva.Line({
    id: obj.id,
    points: obj.points ?? [],
    stroke: obj.style.color,
    strokeWidth: obj.style.strokeWidth * 4,
    opacity: obj.style.opacity ?? 0.35,
    lineCap: "round",
    lineJoin: "round",
    globalCompositeOperation: "multiply",
    ...obj.transform,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/annotation/tools/highlight.ts
git commit -m "feat: implement highlight marker tool with freehand and straight modes"
```

---

## Task 13: Blur Tool

**Files:**
- Create: `src/annotation/tools/blur.ts`

- [ ] **Step 1: Implement blur tool**

Create `src/annotation/tools/blur.ts`:

```typescript
import Konva from "konva";
import { getLayer, getStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";

let startX = 0;
let startY = 0;
let currentRect: Konva.Rect | null = null;
let currentPoints: number[] = [];
let currentLine: Konva.Line | null = null;

function pixelate(imageData: ImageData, blockSize: number): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(width, height);

  for (let y = 0; y < height; y += blockSize) {
    for (let x = 0; x < width; x += blockSize) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      a = Math.round(a / count);
      for (let dy = 0; dy < blockSize && y + dy < height; dy++) {
        for (let dx = 0; dx < blockSize && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4;
          out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
        }
      }
    }
  }
  return out;
}

function gaussianBlur(imageData: ImageData, radius: number): ImageData {
  const { data, width, height } = imageData;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const size = radius * 2 + 1;
  const kernel: number[] = [];
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const val = Math.exp(-(x * x) / (2 * radius * radius));
    kernel.push(val);
    sum += val;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  // Horizontal pass
  const temp = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sx = Math.min(Math.max(x + k - radius, 0), width - 1);
        const i = (y * width + sx) * 4;
        r += data[i] * kernel[k]; g += data[i + 1] * kernel[k];
        b += data[i + 2] * kernel[k]; a += data[i + 3] * kernel[k];
      }
      const i = (y * width + x) * 4;
      temp[i] = r; temp[i + 1] = g; temp[i + 2] = b; temp[i + 3] = a;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < size; k++) {
        const sy = Math.min(Math.max(y + k - radius, 0), height - 1);
        const i = (sy * width + x) * 4;
        r += temp[i] * kernel[k]; g += temp[i + 1] * kernel[k];
        b += temp[i + 2] * kernel[k]; a += temp[i + 3] * kernel[k];
      }
      const i = (y * width + x) * 4;
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = a;
    }
  }
  return out;
}

function getBackgroundImageData(x: number, y: number, w: number, h: number): ImageData | null {
  const bgImg = document.querySelector("[data-frozen-layer]") as HTMLImageElement | null;
  if (!bgImg) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bgImg, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function applyBlur(
  x: number, y: number, w: number, h: number,
  mode: "mosaic" | "gaussian", intensity: number
): Konva.Image | null {
  const imageData = getBackgroundImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  if (!imageData) return null;

  const blurred = mode === "mosaic"
    ? pixelate(imageData, intensity)
    : gaussianBlur(imageData, intensity);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(blurred, 0, 0);

  return new Konva.Image({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
    image: canvas,
  });
}

export function onBlurStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;
  const { activeStyle } = useAnnotation.getState();
  startX = x;
  startY = y;

  if (activeStyle.blurMethod === "freehand") {
    currentPoints = [x, y];
    currentLine = new Konva.Line({
      points: currentPoints,
      stroke: "rgba(100,100,255,0.3)",
      strokeWidth: 20,
      lineCap: "round",
      lineJoin: "round",
      listening: false,
    });
    layer.add(currentLine);
  } else {
    currentRect = new Konva.Rect({
      x, y, width: 0, height: 0,
      stroke: "rgba(100,100,255,0.5)",
      strokeWidth: 1,
      dash: [4, 4],
      listening: false,
    });
    layer.add(currentRect);
  }
}

export function onBlurMove(x: number, y: number) {
  const { activeStyle } = useAnnotation.getState();
  if (activeStyle.blurMethod === "freehand" && currentLine) {
    currentPoints.push(x, y);
    currentLine.points([...currentPoints]);
  } else if (currentRect) {
    const w = x - startX;
    const h = y - startY;
    currentRect.x(w < 0 ? x : startX);
    currentRect.y(h < 0 ? y : startY);
    currentRect.width(Math.abs(w));
    currentRect.height(Math.abs(h));
  }
  getLayer()?.batchDraw();
}

export function onBlurEnd(x: number, y: number): AnnotationObject | null {
  const layer = getLayer();
  const { activeStyle } = useAnnotation.getState();
  const intensity = activeStyle.blurIntensity ?? 10;

  if (activeStyle.blurMethod === "freehand" && currentLine) {
    currentLine.destroy();
    currentLine = null;
    if (currentPoints.length < 4) { currentPoints = []; return null; }

    // Get bounding box of freehand path
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < currentPoints.length; i += 2) {
      minX = Math.min(minX, currentPoints[i]);
      minY = Math.min(minY, currentPoints[i + 1]);
      maxX = Math.max(maxX, currentPoints[i]);
      maxY = Math.max(maxY, currentPoints[i + 1]);
    }
    const pad = 10;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const blurImage = applyBlur(minX, minY, maxX - minX, maxY - minY, activeStyle.blurMode ?? "mosaic", intensity);
    if (!blurImage || !layer) { currentPoints = []; return null; }

    const id = crypto.randomUUID();
    blurImage.id(id);
    blurImage.listening(true);
    layer.add(blurImage);
    layer.batchDraw();

    const obj: AnnotationObject = {
      id,
      type: "blur",
      points: [...currentPoints],
      start: { x: minX, y: minY },
      end: { x: maxX, y: maxY },
      style: { ...activeStyle },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    currentPoints = [];
    return obj;
  }

  if (currentRect) {
    currentRect.destroy();
    currentRect = null;
    const w = Math.abs(x - startX);
    const h = Math.abs(y - startY);
    if (w < 4 || h < 4) return null;

    const rx = Math.min(startX, x);
    const ry = Math.min(startY, y);

    const blurImage = applyBlur(rx, ry, w, h, activeStyle.blurMode ?? "mosaic", intensity);
    if (!blurImage || !layer) return null;

    const id = crypto.randomUUID();
    blurImage.id(id);
    blurImage.listening(true);
    layer.add(blurImage);
    layer.batchDraw();

    const obj: AnnotationObject = {
      id,
      type: "blur",
      start: { x: rx, y: ry },
      end: { x: rx + w, y: ry + h },
      style: { ...activeStyle },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    return obj;
  }

  return null;
}
```

- [ ] **Step 2: Add `data-frozen-layer` attribute to FrozenLayer**

In `src/overlay/FrozenLayer.tsx`, add `data-frozen-layer` attribute to the `<img>` element so the blur tool can access the background image:

```typescript
// Add data-frozen-layer to the img element
<img ... data-frozen-layer />
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/annotation/tools/blur.ts src/overlay/FrozenLayer.tsx
git commit -m "feat: implement blur tool with mosaic and gaussian modes"
```

---

## Task 14: Eraser Tool

**Files:**
- Create: `src/annotation/tools/eraser.ts`

- [ ] **Step 1: Implement eraser tool**

Create `src/annotation/tools/eraser.ts`:

```typescript
import Konva from "konva";
import { getLayer, getStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";

let eraserPoints: number[] = [];
let eraserLine: Konva.Line | null = null;

function pathIntersectsRect(
  points: number[],
  x: number, y: number, w: number, h: number
): boolean {
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      return true;
    }
  }
  return false;
}

export function onEraserStart(x: number, y: number) {
  const layer = getLayer();
  if (!layer) return;

  eraserPoints = [x, y];
  const { activeStyle } = useAnnotation.getState();

  eraserLine = new Konva.Line({
    points: eraserPoints,
    stroke: "rgba(255,255,255,0.5)",
    strokeWidth: activeStyle.strokeWidth * 4,
    lineCap: "round",
    lineJoin: "round",
    dash: [4, 4],
    listening: false,
  });
  layer.add(eraserLine);
}

export function onEraserMove(x: number, y: number) {
  if (!eraserLine) return;
  eraserPoints.push(x, y);
  eraserLine.points([...eraserPoints]);
  getLayer()?.batchDraw();
}

export function onEraserEnd() {
  if (!eraserLine) return;
  eraserLine.destroy();
  eraserLine = null;

  const { objects, deleteObject } = useAnnotation.getState();
  const layer = getLayer();
  if (!layer) return;

  const toDelete: string[] = [];

  for (const obj of objects) {
    const node = layer.findOne(`#${obj.id}`);
    if (!node) continue;
    const box = node.getClientRect();
    if (pathIntersectsRect(eraserPoints, box.x, box.y, box.width, box.height)) {
      toDelete.push(obj.id);
    }
  }

  for (const id of toDelete) {
    const node = layer.findOne(`#${id}`);
    node?.destroy();
    deleteObject(id);
  }

  eraserPoints = [];
  layer.batchDraw();
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/annotation/tools/eraser.ts
git commit -m "feat: implement eraser tool with bounding box intersection"
```

---

## Task 15: Stage Event Routing (Connect Tools to Canvas)

**Files:**
- Modify: `src/annotation/Stage.tsx`

- [ ] **Step 1: Add pointer event routing to Stage**

Update `src/annotation/Stage.tsx` to route pointer events to the active tool. Add the following event handlers to the Konva Stage after it's created:

```typescript
import { onDrawStart, onDrawMove, onDrawEnd } from "@/annotation/tools/draw";
import { onLineStart, onLineMove, onLineEnd } from "@/annotation/tools/line";
import { onRectStart, onRectMove, onRectEnd } from "@/annotation/tools/rect";
import { onEllipseStart, onEllipseMove, onEllipseEnd } from "@/annotation/tools/ellipse";
import { onHighlightStart, onHighlightMove, onHighlightEnd } from "@/annotation/tools/highlight";
import { onBlurStart, onBlurMove, onBlurEnd } from "@/annotation/tools/blur";
import { onEraserStart, onEraserMove, onEraserEnd } from "@/annotation/tools/eraser";

type ToolHandlers = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => AnnotationObject | null;
};

const TOOL_HANDLERS: Partial<Record<ToolType, ToolHandlers>> = {
  draw: { start: onDrawStart, move: onDrawMove, end: onDrawEnd },
  line: { start: onLineStart, move: onLineMove, end: onLineEnd },
  rect: { start: onRectStart, move: onRectMove, end: onRectEnd },
  ellipse: { start: onEllipseStart, move: onEllipseMove, end: onEllipseEnd },
  highlight: { start: onHighlightStart, move: onHighlightMove, end: onHighlightEnd },
  blur: { start: onBlurStart, move: onBlurMove, end: onBlurEnd },
  eraser: { start: onEraserStart, move: onEraserMove, end: onEraserEnd as any },
};
```

Add mouse event handlers to the container div:

```typescript
const handleMouseDown = (e: React.MouseEvent) => {
  const { activeTool, objects, setSelectedObject, setDrawingState } = useAnnotation.getState();
  const rect = containerRef.current!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Smart click-to-select: check if clicking on existing object
  if (activeTool !== "eraser") {
    const stage = getStage();
    const shape = stage?.getIntersection({ x, y });
    if (shape && shape.id()) {
      const obj = objects.find((o) => o.id === shape.id());
      if (obj) {
        setSelectedObject(obj.id);
        // Attach transformer
        const transformer = getTransformer();
        if (transformer) {
          transformer.nodes([shape]);
          getLayer()?.batchDraw();
        }
        return;
      }
    }
  }

  // Deselect if select tool and clicking empty
  if (activeTool === "select") {
    setSelectedObject(null);
    const transformer = getTransformer();
    if (transformer) { transformer.nodes([]); getLayer()?.batchDraw(); }
    return;
  }

  // Start drawing
  const handlers = TOOL_HANDLERS[activeTool];
  if (handlers) {
    setDrawingState("active");
    handlers.start(x, y);
  }
};

const handleMouseMove = (e: React.MouseEvent) => {
  const { activeTool, drawingState } = useAnnotation.getState();
  if (drawingState !== "active") return;

  const rect = containerRef.current!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const handlers = TOOL_HANDLERS[activeTool];
  if (handlers) handlers.move(x, y);
};

const handleMouseUp = (e: React.MouseEvent) => {
  const { activeTool, drawingState, setDrawingState, addObject } = useAnnotation.getState();
  if (drawingState !== "active") return;

  const rect = containerRef.current!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const handlers = TOOL_HANDLERS[activeTool];
  if (handlers) {
    if (activeTool === "eraser") {
      onEraserEnd();
    } else {
      const obj = handlers.end(x, y);
      if (obj) addObject(obj);
    }
  }
  setDrawingState("idle");
};
```

Add these handlers to the container div:

```tsx
<div
  ref={containerRef}
  onMouseDown={handleMouseDown}
  onMouseMove={handleMouseMove}
  onMouseUp={handleMouseUp}
  style={{ ... }}
/>
```

- [ ] **Step 2: Verify build succeeds**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/annotation/Stage.tsx
git commit -m "feat: wire pointer events to annotation tools via Stage routing"
```

---

## Task 16: Property Panel Implementation

**Files:**
- Modify: `src/annotation/PropertyPanel.tsx`

- [ ] **Step 1: Implement full property panel**

Replace the placeholder `src/annotation/PropertyPanel.tsx` with the full implementation:

```typescript
import { type CSSProperties } from "react";
import { useAnnotation } from "@/annotation/store";
import {
  PRESET_COLORS,
  STROKE_WIDTHS,
  FONT_SIZES,
  type ToolType,
  type AnnotationStyle,
} from "@/annotation/types";

type Props = {
  tool: ToolType;
  style?: CSSProperties;
};

export function PropertyPanel({ tool, style: containerStyle }: Props) {
  const activeStyle = useAnnotation((s) => s.activeStyle);
  const setActiveStyle = useAnnotation((s) => s.setActiveStyle);

  const panelStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 8,
    background: "rgba(30, 30, 30, 0.9)",
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    ...containerStyle,
  };

  return (
    <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
      {/* Color picker - shown for all tools except eraser */}
      {tool !== "eraser" && tool !== "blur" && (
        <ColorPicker
          value={activeStyle.color}
          onChange={(color) => setActiveStyle({ color })}
        />
      )}

      {/* Stroke width - shown for draw, line, rect, ellipse, highlight, eraser */}
      {["draw", "line", "rect", "ellipse", "highlight", "eraser"].includes(tool) && (
        <StrokeWidthPicker
          value={activeStyle.strokeWidth}
          onChange={(strokeWidth) => setActiveStyle({ strokeWidth })}
        />
      )}

      {/* Line-specific options */}
      {tool === "line" && (
        <>
          <Separator />
          <ToggleGroup
            options={[
              { value: "straight", label: "—" },
              { value: "wavy", label: "∿" },
            ]}
            value={activeStyle.lineShape ?? "straight"}
            onChange={(v) => setActiveStyle({ lineShape: v as any })}
          />
          <ToggleGroup
            options={[
              { value: "solid", label: "━" },
              { value: "dotted", label: "┈" },
              { value: "dashed", label: "╌" },
            ]}
            value={activeStyle.lineStyle ?? "solid"}
            onChange={(v) => setActiveStyle({ lineStyle: v as any })}
          />
          <ToggleGroup
            options={[
              { value: "none", label: "○" },
              { value: "start", label: "←" },
              { value: "end", label: "→" },
              { value: "both", label: "↔" },
            ]}
            value={activeStyle.arrow ?? "none"}
            onChange={(v) => setActiveStyle({ arrow: v as any })}
          />
          <ToggleGroup
            options={[
              { value: "v-shape", label: ">" },
              { value: "filled-triangle", label: "▶" },
            ]}
            value={activeStyle.arrowStyle ?? "v-shape"}
            onChange={(v) => setActiveStyle({ arrowStyle: v as any })}
          />
        </>
      )}

      {/* Shape fill options */}
      {(tool === "rect" || tool === "ellipse") && (
        <>
          <Separator />
          <ToggleGroup
            options={[
              { value: "hollow", label: "□" },
              { value: "solid", label: "■" },
            ]}
            value={activeStyle.fill ?? "hollow"}
            onChange={(v) => setActiveStyle({ fill: v as any })}
          />
          {tool === "rect" && (
            <ToggleGroup
              options={[
                { value: "0", label: "┐" },
                { value: "8", label: "╮" },
              ]}
              value={String(activeStyle.cornerRadius ?? 0)}
              onChange={(v) => setActiveStyle({ cornerRadius: Number(v) })}
            />
          )}
        </>
      )}

      {/* Text options */}
      {tool === "text" && (
        <>
          <Separator />
          <ToggleGroup
            options={[
              { value: "Excalifont", label: "Aa" },
              { value: "sans-serif", label: "Aa" },
              { value: "serif", label: "Aa" },
              { value: "monospace", label: "Aa" },
            ]}
            value={activeStyle.fontFamily ?? "Excalifont"}
            onChange={(v) => setActiveStyle({ fontFamily: v })}
          />
          <FontSizePicker
            value={activeStyle.fontSize ?? 24}
            onChange={(fontSize) => setActiveStyle({ fontSize })}
          />
        </>
      )}

      {/* Blur options */}
      {tool === "blur" && (
        <>
          <ToggleGroup
            options={[
              { value: "mosaic", label: "▦" },
              { value: "gaussian", label: "◌" },
            ]}
            value={activeStyle.blurMode ?? "mosaic"}
            onChange={(v) => setActiveStyle({ blurMode: v as any })}
          />
          <ToggleGroup
            options={[
              { value: "rect", label: "□" },
              { value: "freehand", label: "✎" },
            ]}
            value={activeStyle.blurMethod ?? "rect"}
            onChange={(v) => setActiveStyle({ blurMethod: v as any })}
          />
          <ToggleGroup
            options={[
              { value: "6", label: "S" },
              { value: "10", label: "M" },
              { value: "16", label: "L" },
            ]}
            value={String(activeStyle.blurIntensity ?? 10)}
            onChange={(v) => setActiveStyle({ blurIntensity: Number(v) })}
          />
        </>
      )}

      {/* Highlight options */}
      {tool === "highlight" && (
        <>
          <Separator />
          <ToggleGroup
            options={[
              { value: "freehand", label: "✎" },
              { value: "straight", label: "—" },
            ]}
            value={activeStyle.highlightMode ?? "freehand"}
            onChange={(v) => setActiveStyle({ highlightMode: v as any })}
          />
        </>
      )}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: c,
            border: c === value ? "2px solid #fff" : "2px solid transparent",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 20, height: 20, border: "none", padding: 0, cursor: "pointer" }}
      />
    </div>
  );
}

function StrokeWidthPicker({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          style={{
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: "none",
            background: w === value ? "rgba(255,255,255,0.15)" : "transparent",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <div
            style={{
              width: 16,
              height: Math.max(w, 2),
              borderRadius: w / 2,
              background: w === value ? "#fff" : "rgba(255,255,255,0.6)",
            }}
          />
        </button>
      ))}
    </div>
  );
}

function FontSizePicker({ value, onChange }: { value: number; onChange: (s: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {FONT_SIZES.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          style={{
            padding: "2px 6px",
            borderRadius: 4,
            border: "none",
            background: s === value ? "rgba(255,255,255,0.15)" : "transparent",
            color: s === value ? "#fff" : "rgba(255,255,255,0.6)",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ToggleGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "3px 6px",
            borderRadius: 4,
            border: "none",
            background: opt.value === value ? "rgba(255,255,255,0.15)" : "transparent",
            color: opt.value === value ? "#fff" : "rgba(255,255,255,0.6)",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Separator() {
  return (
    <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
  );
}
```

- [ ] **Step 2: Verify build succeeds**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/annotation/PropertyPanel.tsx
git commit -m "feat: implement property panel with color, stroke, and tool-specific options"
```

---

## Task 17: Export Logic and IPC Updates

**Files:**
- Create: `src/annotation/export.ts`
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Create export module**

Create `src/annotation/export.ts`:

```typescript
import { getStage } from "@/annotation/Stage";
import { getTransformer } from "@/annotation/Stage";

export async function exportAnnotationLayer(scaleFactor: number): Promise<ArrayBuffer | null> {
  const stage = getStage();
  if (!stage) return null;

  // Hide transformer before export
  const transformer = getTransformer();
  const wasVisible = transformer?.visible() ?? false;
  transformer?.visible(false);
  stage.batchDraw();

  const blob = await new Promise<Blob | null>((resolve) => {
    stage.toBlob({
      pixelRatio: scaleFactor,
      mimeType: "image/png",
      callback: (blob) => resolve(blob),
    });
  });

  // Restore transformer
  transformer?.visible(wasVisible);
  stage.batchDraw();

  if (!blob) return null;
  return blob.arrayBuffer();
}
```

- [ ] **Step 2: Update IPC functions**

Modify `src/lib/ipc.ts` — update `cropAndCopy` and `cropAndSave` to accept optional annotation data:

```typescript
export async function cropAndCopy(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer
): Promise<void> {
  await invoke("crop_and_copy", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
  });
}

export async function cropAndSave(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer
): Promise<string | null> {
  return invoke("crop_and_save", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
  });
}
```

- [ ] **Step 3: Update Overlay handlers to export annotations**

In `src/routes/Overlay.tsx`, update the copy/save handlers to export the annotation layer:

```typescript
import { exportAnnotationLayer } from "@/annotation/export";

const handleCopy = async () => {
  if (monitorId === null || !selection) return;
  const annotationPng = await exportAnnotationLayer(scaleFactor);
  await cropAndCopy(monitorId, selection, annotationPng ?? undefined);
};

const handleSave = async () => {
  if (monitorId === null || !selection) return;
  const annotationPng = await exportAnnotationLayer(scaleFactor);
  await cropAndSave(monitorId, selection, annotationPng ?? undefined);
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add src/annotation/export.ts src/lib/ipc.ts src/routes/Overlay.tsx
git commit -m "feat: add annotation export and update IPC to pass annotation PNG"
```

---

## Task 18: Rust-Side Alpha Compositing

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Update crop_and_copy command**

In `src-tauri/src/commands.rs`, add `annotation_png` parameter to both commands:

```rust
#[tauri::command]
pub async fn crop_and_copy(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<(), String> {
    let frame = mgr.frame(monitor_id).ok_or("No frame")?;
    let scale = mgr.scale_factor(monitor_id).unwrap_or(1.0);
    let cropped = crop_rgba(&frame.rgba, frame.width, frame.height, rect, scale)
        .ok_or("Crop failed")?;

    let final_image = if let Some(png_data) = annotation_png {
        composite_annotation(&cropped, &png_data)?
    } else {
        cropped
    };

    clipboard::copy_image(&final_image.rgba, final_image.width, final_image.height)
        .map_err(|e| e.to_string())?;

    mgr.end(&app);
    Ok(())
}
```

- [ ] **Step 2: Update crop_and_save command similarly**

```rust
#[tauri::command]
pub async fn crop_and_save(
    monitor_id: u32,
    rect: Rect,
    annotation_png: Option<Vec<u8>>,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
) -> Result<Option<String>, String> {
    let frame = mgr.frame(monitor_id).ok_or("No frame")?;
    let scale = mgr.scale_factor(monitor_id).unwrap_or(1.0);
    let cropped = crop_rgba(&frame.rgba, frame.width, frame.height, rect, scale)
        .ok_or("Crop failed")?;

    let final_image = if let Some(png_data) = annotation_png {
        composite_annotation(&cropped, &png_data)?
    } else {
        cropped
    };

    mgr.end(&app);

    // ... rest of save dialog logic uses final_image instead of cropped
}
```

- [ ] **Step 3: Implement composite_annotation function**

```rust
use image::{ImageBuffer, Rgba, RgbaImage, imageops};

fn composite_annotation(base: &CroppedImage, annotation_png: &[u8]) -> Result<CroppedImage, String> {
    let mut base_img: RgbaImage = ImageBuffer::from_raw(base.width, base.height, base.rgba.clone())
        .ok_or("Failed to create base image buffer")?;

    let annotation_img = image::load_from_memory_with_format(annotation_png, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to decode annotation PNG: {}", e))?
        .to_rgba8();

    imageops::overlay(&mut base_img, &annotation_img, 0, 0);

    Ok(CroppedImage {
        rgba: base_img.into_raw(),
        width: base.width,
        height: base.height,
    })
}
```

- [ ] **Step 4: Verify Rust compiles**

```bash
cd src-tauri && cargo check
```

Expected: Compiles without errors.

- [ ] **Step 5: Run Rust tests**

```bash
cd src-tauri && cargo test
```

Expected: All existing tests pass.

- [ ] **Step 6: Run clippy**

```bash
cd src-tauri && cargo clippy -- -D warnings
```

Expected: No warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat: add annotation PNG alpha-compositing in Rust crop commands"
```

---

## Task 19: Text Tool Integration and Selection Resize Coordination

**Files:**
- Modify: `src/annotation/Stage.tsx`
- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Add text tool handling to Stage**

In `src/annotation/Stage.tsx`, add text tool click handling. When the text tool is active and user clicks on the canvas, emit a state change that triggers the TextOverlay:

```typescript
// In handleMouseDown, add text tool case before the general drawing handlers:
if (activeTool === "text") {
  const rect = containerRef.current!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Check if double-clicking existing text
  const stage = getStage();
  const shape = stage?.getIntersection({ x, y });
  if (shape && shape.id()) {
    const obj = objects.find((o) => o.id === shape.id() && o.type === "text");
    if (obj) {
      // Remove from canvas for editing
      shape.destroy();
      getLayer()?.batchDraw();
      useAnnotation.getState().deleteObject(obj.id);
      setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: obj });
      return;
    }
  }

  setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: null });
  return;
}
```

Add state for text editing:

```typescript
const [textEditing, setTextEditing] = useState<{
  position: { x: number; y: number };
  editingObject: AnnotationObject | null;
} | null>(null);
```

Render TextOverlay when textEditing is set:

```tsx
{textEditing && (
  <TextOverlay
    position={textEditing.position}
    selection={selection}
    editingObject={textEditing.editingObject}
    onConfirm={(obj) => {
      addTextToLayer(obj);
      useAnnotation.getState().addObject(obj);
      setTextEditing(null);
    }}
    onCancel={() => setTextEditing(null)}
  />
)}
```

- [ ] **Step 2: Add selection resize coordination**

In `src/routes/Overlay.tsx`, when the selection is resized (during `updateSelectionInteraction`), update the Konva Stage size. Add an effect:

```typescript
useEffect(() => {
  if (mode !== "committed" || !selection) return;
  const stage = getStage();
  if (stage) {
    stage.width(selection.width);
    stage.height(selection.height);
    stage.batchDraw();
  }
}, [selection?.width, selection?.height, mode]);
```

- [ ] **Step 3: Verify build succeeds**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/annotation/Stage.tsx src/routes/Overlay.tsx
git commit -m "feat: integrate text tool and selection resize coordination"
```

---

## Task 20: End-to-End Integration Test

**Files:**
- Modify: `src/routes/Overlay.tsx` (final wiring)
- All annotation modules

- [ ] **Step 1: Verify full app runs in dev mode**

```bash
pnpm tauri dev
```

Expected: App launches, hotkey triggers capture, selection commits, annotation toolbar appears with all tools.

- [ ] **Step 2: Test each tool manually**

Test the following in the running app:
1. Select tool — click objects to select, transformer appears
2. Pen tool — freehand draw, stroke appears
3. Line tool — straight line with arrow
4. Rectangle tool — hollow and solid rectangles
5. Ellipse tool — hollow and solid ellipses
6. Text tool — click to place, type text, Cmd+Enter to confirm
7. Blur tool — drag rectangle, mosaic appears
8. Highlight tool — freehand highlight with transparency
9. Eraser tool — swipe over objects to delete them
10. Undo/Redo — Cmd+Z undoes last action, Cmd+Shift+Z redoes
11. Copy — Cmd+C copies screenshot with annotations to clipboard
12. Save — Cmd+S saves screenshot with annotations to file

- [ ] **Step 3: Test property panel**

1. Click pen tool → property panel shows color + stroke width
2. Click line tool → shows color, stroke width, shape, style, arrow options
3. Click rect tool → shows color, stroke width, fill, corner radius
4. Click text tool → shows color, font family, font size
5. Click blur tool → shows mode, method, intensity
6. Click highlight tool → shows color, stroke width, line mode

- [ ] **Step 4: Test edge cases**

1. Resize selection after drawing annotations → annotations clip correctly
2. Draw annotation near selection edge → doesn't overflow
3. Esc during drawing → exits capture (not just annotation)
4. Multiple monitors → annotation only on active monitor

- [ ] **Step 5: Fix any issues found during testing**

Address any bugs discovered during manual testing.

- [ ] **Step 6: Run all automated tests**

```bash
pnpm test
cd src-tauri && cargo test && cargo clippy -- -D warnings
```

Expected: All tests pass, no clippy warnings.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete v0.2.0 annotation feature integration"
```

---

## Summary

| Task | Description | Estimated Effort |
|------|-------------|-----------------|
| 1 | Install dependencies + font | 5 min |
| 2 | Annotation types and constants | 5 min |
| 3 | Command stack (undo/redo) with tests | 15 min |
| 4 | Annotation Zustand store with tests | 15 min |
| 5 | Konva Stage container | 10 min |
| 6 | Annotation toolbar | 15 min |
| 7 | Integrate into overlay | 15 min |
| 8 | Pen tool (freehand) | 10 min |
| 9 | Rectangle + ellipse tools | 10 min |
| 10 | Line tool (all variants) | 15 min |
| 11 | Text tool + TextOverlay | 15 min |
| 12 | Highlight tool | 10 min |
| 13 | Blur tool (mosaic + gaussian) | 20 min |
| 14 | Eraser tool | 10 min |
| 15 | Stage event routing | 15 min |
| 16 | Property panel (full) | 20 min |
| 17 | Export logic + IPC updates | 10 min |
| 18 | Rust alpha-compositing | 15 min |
| 19 | Text integration + resize coordination | 10 min |
| 20 | End-to-end integration test | 30 min |

**Total estimated: ~4-5 hours**
