import { create } from "zustand";
import { createCommandStack, type CommandStack } from "@/annotation/commands";
import { normalizeTextStyle } from "@/annotation/fonts";
import {
  DEFAULT_STYLE,
  type AnnotationId,
  type AnnotationObject,
  type AnnotationStyle,
  type Command,
  type ToolType,
} from "@/annotation/types";

const STYLE_STORAGE_KEY = "flashot:annotation-style";
const TOOL_STYLE_STORAGE_KEY = "flashot:annotation-tool-style";

function loadPersistedStyle(): AnnotationStyle {
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY);
    if (raw) return normalizeTextStyle({ ...DEFAULT_STYLE, ...JSON.parse(raw) });
  } catch { /* ignore */ }
  return normalizeTextStyle({ ...DEFAULT_STYLE });
}

function persistStyle(style: AnnotationStyle) {
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(style));
  } catch { /* ignore */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMarkerNumber(value: unknown): number {
  return Math.max(1, Math.trunc(finiteNumber(value, 1)));
}

type ToolStyleMemory = {
  line: Pick<AnnotationStyle, "lineShape" | "lineStyle">;
  arrow: Pick<AnnotationStyle, "lineStyle" | "arrowStyle">;
  measure: Pick<AnnotationStyle, "color" | "strokeWidth">;
  highlight: Pick<AnnotationStyle, "strokeWidth" | "cornerRadius">;
};

function lineToolStyle(style: Partial<AnnotationStyle>): ToolStyleMemory["line"] {
  const lineShape = style.lineShape ?? DEFAULT_STYLE.lineShape;
  return {
    lineShape,
    lineStyle: lineShape === "wavy" ? "solid" : (style.lineStyle ?? DEFAULT_STYLE.lineStyle),
  };
}

function arrowToolStyle(style: Partial<AnnotationStyle>): ToolStyleMemory["arrow"] {
  return {
    lineStyle: style.lineStyle ?? DEFAULT_STYLE.lineStyle,
    arrowStyle: style.arrowStyle ?? DEFAULT_STYLE.arrowStyle,
  };
}

function measureToolStyle(style: Partial<AnnotationStyle>): ToolStyleMemory["measure"] {
  return {
    color: style.color ?? DEFAULT_STYLE.color,
    strokeWidth: style.strokeWidth ?? DEFAULT_STYLE.strokeWidth,
  };
}

function highlightToolStyle(style: Partial<AnnotationStyle>): ToolStyleMemory["highlight"] {
  return {
    strokeWidth: style.strokeWidth ?? DEFAULT_STYLE.strokeWidth,
    cornerRadius: style.cornerRadius ?? DEFAULT_STYLE.cornerRadius,
  };
}

function createToolStyleMemory(style: AnnotationStyle): ToolStyleMemory {
  return {
    line: lineToolStyle(style),
    arrow: arrowToolStyle(style),
    measure: measureToolStyle(style),
    highlight: highlightToolStyle(style),
  };
}

function loadPersistedToolStyleMemory(style: AnnotationStyle): {
  memory: ToolStyleMemory;
  hasRememberedMeasure: boolean;
  hasRememberedHighlight: boolean;
} {
  const memory = createToolStyleMemory(style);
  let hasRememberedMeasure = false;
  let hasRememberedHighlight = false;

  try {
    const raw = localStorage.getItem(TOOL_STYLE_STORAGE_KEY);
    if (!raw) return { memory, hasRememberedMeasure, hasRememberedHighlight };

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { memory, hasRememberedMeasure, hasRememberedHighlight };

    if (isRecord(parsed.measure)) {
      memory.measure = {
        color: typeof parsed.measure.color === "string" ? parsed.measure.color : memory.measure.color,
        strokeWidth: finiteNumber(parsed.measure.strokeWidth, memory.measure.strokeWidth),
      };
      hasRememberedMeasure = true;
    }

    if (isRecord(parsed.highlight)) {
      memory.highlight = {
        strokeWidth: finiteNumber(parsed.highlight.strokeWidth, memory.highlight.strokeWidth),
        cornerRadius: finiteNumber(parsed.highlight.cornerRadius, memory.highlight.cornerRadius ?? 0),
      };
      hasRememberedHighlight = true;
    }
  } catch { /* ignore */ }

  return { memory, hasRememberedMeasure, hasRememberedHighlight };
}

function persistToolStyleMemory() {
  try {
    localStorage.setItem(TOOL_STYLE_STORAGE_KEY, JSON.stringify({
      measure: toolStyleMemory.measure,
      highlight: toolStyleMemory.highlight,
    }));
  } catch { /* ignore */ }
}

function normalizeFocusStyle(style: AnnotationStyle): AnnotationStyle {
  const focusOpacity = finiteNumber(style.focusOpacity, DEFAULT_STYLE.focusOpacity ?? 0.45);
  const focusMode = style.focusMode === "spotlight" ? "spotlight" : "none";
  const focusColor = typeof style.focusColor === "string" ? style.focusColor : (DEFAULT_STYLE.focusColor ?? "#000000");

  return {
    ...style,
    focusMode,
    focusOpacity: Math.max(0, Math.min(1, focusOpacity)),
    focusColor,
  };
}

function normalizeMagnifierStyle(style: AnnotationStyle): AnnotationStyle {
  const magnifierZoom = finiteNumber(style.magnifierZoom, DEFAULT_STYLE.magnifierZoom ?? 1.5);
  const magnifierBorderWidth = finiteNumber(style.magnifierBorderWidth, DEFAULT_STYLE.magnifierBorderWidth ?? 2);
  const magnifierCornerRadius = finiteNumber(style.magnifierCornerRadius, DEFAULT_STYLE.magnifierCornerRadius ?? 12);

  return {
    ...style,
    magnifierShape: style.magnifierShape === "rounded-rect" ? "rounded-rect" : "circle",
    magnifierZoom: Math.max(1.1, Math.min(2, magnifierZoom)),
    magnifierBorderColor: typeof style.magnifierBorderColor === "string" ? style.magnifierBorderColor : (DEFAULT_STYLE.magnifierBorderColor ?? "#ffffff"),
    magnifierBorderWidth: Math.max(1, Math.min(20, magnifierBorderWidth)),
    magnifierCornerRadius: Math.max(0, Math.min(60, magnifierCornerRadius)),
  };
}

function normalizeActiveStyleForTool(tool: ToolType, style: AnnotationStyle): AnnotationStyle {
  style = normalizeMagnifierStyle(normalizeFocusStyle(normalizeTextStyle(style)));
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
  if (tool === "highlight") {
    return { ...style, ...highlightToolStyle(style) };
  }
  return style;
}

function usesIsolatedToolStyle(tool: ToolType): boolean {
  return tool === "measure" || tool === "highlight";
}

function rememberToolStyle(tool: ToolType, style: AnnotationStyle) {
  if (tool === "line") {
    toolStyleMemory.line = lineToolStyle(style);
  } else if (tool === "arrow") {
    toolStyleMemory.arrow = arrowToolStyle(style);
  } else if (tool === "measure") {
    toolStyleMemory.measure = measureToolStyle(style);
    hasRememberedMeasureToolStyle = true;
    persistToolStyleMemory();
  } else if (tool === "highlight") {
    toolStyleMemory.highlight = highlightToolStyle(style);
    hasRememberedHighlightToolStyle = true;
    persistToolStyleMemory();
  }
}

function styleForTool(tool: ToolType, baseStyle: AnnotationStyle): AnnotationStyle {
  if (tool === "line") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.line });
  }
  if (tool === "arrow") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.arrow });
  }
  if (tool === "measure") {
    if (!hasRememberedMeasureToolStyle) {
      return normalizeActiveStyleForTool(tool, baseStyle);
    }
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.measure });
  }
  if (tool === "highlight") {
    if (!hasRememberedHighlightToolStyle) {
      return normalizeActiveStyleForTool(tool, baseStyle);
    }
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.highlight });
  }
  return baseStyle;
}

type DrawingState = "idle" | "active";

type AnnotationState = {
  objects: AnnotationObject[];
  activeTool: ToolType;
  activeStyle: AnnotationStyle;
  selectedObjectId: AnnotationId | null;
  drawingState: DrawingState;
  currentMarkerNumber: number;
  canUndo: boolean;
  canRedo: boolean;
};

type AnnotationActions = {
  setActiveTool: (tool: ToolType) => void;
  setActiveStyle: (style: Partial<AnnotationStyle>) => void;
  setDrawingState: (state: DrawingState) => void;
  setSelectedObject: (id: AnnotationId | null) => void;
  allocateMarkerNumber: () => number;
  setCurrentMarkerNumber: (value: number) => void;
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
const initialActiveStyle = loadPersistedStyle();
const initialToolStyleMemory = loadPersistedToolStyleMemory(initialActiveStyle);
let toolStyleMemory = initialToolStyleMemory.memory;
let hasRememberedMeasureToolStyle = initialToolStyleMemory.hasRememberedMeasure;
let hasRememberedHighlightToolStyle = initialToolStyleMemory.hasRememberedHighlight;

let sharedStyleMemory = initialActiveStyle;

const initialState: AnnotationState = {
  objects: [],
  activeTool: "select",
  activeStyle: initialActiveStyle,
  selectedObjectId: null,
  drawingState: "idle",
  currentMarkerNumber: 1,
  canUndo: false,
  canRedo: false,
};

export const useAnnotation = create<AnnotationState & AnnotationActions>((set, get) => ({
  ...initialState,

  setActiveTool(tool) {
    const { activeTool, activeStyle } = get();
    rememberToolStyle(activeTool, activeStyle);
    if (!usesIsolatedToolStyle(activeTool)) {
      sharedStyleMemory = activeStyle;
    }

    const nextStyle = styleForTool(tool, sharedStyleMemory);
    if (!usesIsolatedToolStyle(tool)) {
      sharedStyleMemory = nextStyle;
      persistStyle(nextStyle);
    }
    set({ activeTool: tool, activeStyle: nextStyle, selectedObjectId: null });
  },

  setActiveStyle(partial) {
    const state = get();
    const activeStyle = normalizeActiveStyleForTool(
      state.activeTool,
      { ...state.activeStyle, ...partial },
    );
    rememberToolStyle(state.activeTool, activeStyle);
    if (!usesIsolatedToolStyle(state.activeTool)) {
      sharedStyleMemory = activeStyle;
      persistStyle(activeStyle);
    }
    set({ activeStyle });
  },

  setDrawingState(drawingState) {
    set({ drawingState });
  },

  setSelectedObject(id) {
    set({ selectedObjectId: id });
  },

  allocateMarkerNumber() {
    const currentMarkerNumber = get().currentMarkerNumber;
    set({ currentMarkerNumber: currentMarkerNumber + 1 });
    return currentMarkerNumber;
  },

  setCurrentMarkerNumber(value) {
    set({ currentMarkerNumber: normalizeMarkerNumber(value) });
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
    const currentMarkerNumber = obj.type === "marker"
      ? Math.max(1, get().currentMarkerNumber - 1)
      : get().currentMarkerNumber;
    set({
      objects,
      currentMarkerNumber,
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
    if ("text" in updates) { before.text = obj.text; after.text = updates.text; }
    if ("markerNumber" in updates) { before.markerNumber = obj.markerNumber; after.markerNumber = updates.markerNumber; }
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
    set({
      objects: [],
      activeTool: "select",
      selectedObjectId: null,
      drawingState: "idle",
      currentMarkerNumber: 1,
      canUndo: false,
      canRedo: false,
    });
  },
}));
