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

type ToolStyleMemory = {
  line: Pick<AnnotationStyle, "lineShape" | "lineStyle">;
  arrow: Pick<AnnotationStyle, "lineStyle" | "arrowStyle">;
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

function createToolStyleMemory(style: AnnotationStyle): ToolStyleMemory {
  return {
    line: lineToolStyle(style),
    arrow: arrowToolStyle(style),
  };
}

function normalizeActiveStyleForTool(tool: ToolType, style: AnnotationStyle): AnnotationStyle {
  style = normalizeTextStyle(style);
  if (tool === "line") {
    return { ...style, ...lineToolStyle(style) };
  }
  if (tool === "arrow") {
    return { ...style, lineShape: "straight", ...arrowToolStyle(style) };
  }
  return style;
}

function rememberToolStyle(tool: ToolType, style: AnnotationStyle) {
  if (tool === "line") {
    toolStyleMemory.line = lineToolStyle(style);
  } else if (tool === "arrow") {
    toolStyleMemory.arrow = arrowToolStyle(style);
  }
}

function styleForTool(tool: ToolType, baseStyle: AnnotationStyle): AnnotationStyle {
  if (tool === "line") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.line });
  }
  if (tool === "arrow") {
    return normalizeActiveStyleForTool(tool, { ...baseStyle, ...toolStyleMemory.arrow });
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
const initialActiveStyle = loadPersistedStyle();
let toolStyleMemory = createToolStyleMemory(initialActiveStyle);

const initialState: AnnotationState = {
  objects: [],
  activeTool: "select",
  activeStyle: initialActiveStyle,
  selectedObjectId: null,
  drawingState: "idle",
  canUndo: false,
  canRedo: false,
};

export const useAnnotation = create<AnnotationState & AnnotationActions>((set, get) => ({
  ...initialState,

  setActiveTool(tool) {
    const { activeTool, activeStyle } = get();
    rememberToolStyle(activeTool, activeStyle);
    const nextStyle = styleForTool(tool, activeStyle);
    persistStyle(nextStyle);
    set({ activeTool: tool, activeStyle: nextStyle, selectedObjectId: null });
  },

  setActiveStyle(partial) {
    const state = get();
    const activeStyle = normalizeActiveStyleForTool(
      state.activeTool,
      { ...state.activeStyle, ...partial },
    );
    rememberToolStyle(state.activeTool, activeStyle);
    persistStyle(activeStyle);
    set({ activeStyle });
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
    set({
      objects: [],
      activeTool: "select",
      selectedObjectId: null,
      drawingState: "idle",
      canUndo: false,
      canRedo: false,
    });
  },
}));
