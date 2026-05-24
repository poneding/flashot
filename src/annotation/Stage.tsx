import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import type { Point, Rect } from "@/lib/types";
import { useAnnotation } from "@/annotation/store";
import { onDrawStart, onDrawMove, onDrawEnd } from "@/annotation/tools/draw";
import {
  lineControlPoint,
  onLineStart,
  onLineMove,
  onLineEnd,
  updateLineObjectNode,
} from "@/annotation/tools/line";
import {
  onMeasureStart,
  onMeasureMove,
  onMeasureEnd,
  updateMeasureObjectNode,
} from "@/annotation/tools/measure";
import { onArrowStart, onArrowMove, onArrowEnd } from "@/annotation/tools/arrow";
import { onRectStart, onRectMove, onRectEnd } from "@/annotation/tools/rect";
import { onEllipseStart, onEllipseMove, onEllipseEnd } from "@/annotation/tools/ellipse";
import { highlightBasePosition, onHighlightStart, onHighlightMove, onHighlightEnd } from "@/annotation/tools/highlight";
import { onBlurStart, onBlurMove, onBlurEnd } from "@/annotation/tools/blur";
import { onEraserStart, onEraserMove, onEraserEnd } from "@/annotation/tools/eraser";
import type { AnnotationObject, ToolType } from "@/annotation/types";
import { TextOverlay } from "@/annotation/TextOverlay";
import { addTextToLayer } from "@/annotation/tools/text";
import { hitTestHandle } from "@/lib/geometry";
import { renderObject } from "@/annotation/render";
import { useOverlay } from "@/overlay/state";

type Props = {
  selection: Rect;
  scaleFactor: number;
  interacting?: boolean;
};

let stage: Konva.Stage | null = null;
let layer: Konva.Layer | null = null;
let transformer: Konva.Transformer | null = null;
let lineEditGroup: Konva.Group | null = null;

type LineEditHandle = "start" | "control" | "end";

const TRANSFORMER_ANCHORS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
];
const EDIT_OVERLAY_NAME = "annotation-edit-overlay";

export function getStage(): Konva.Stage | null {
  return stage;
}

export function getLayer(): Konva.Layer | null {
  return layer;
}

export function getTransformer(): Konva.Transformer | null {
  return transformer;
}

type ToolHandlers = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => AnnotationObject | null;
};

const TOOL_HANDLERS: Partial<Record<ToolType, ToolHandlers>> = {
  draw: { start: onDrawStart, move: onDrawMove, end: (_x, _y) => onDrawEnd() },
  line: { start: onLineStart, move: onLineMove, end: onLineEnd },
  measure: { start: onMeasureStart, move: onMeasureMove, end: onMeasureEnd },
  arrow: { start: onArrowStart, move: onArrowMove, end: onArrowEnd },
  rect: { start: onRectStart, move: onRectMove, end: onRectEnd },
  ellipse: { start: onEllipseStart, move: onEllipseMove, end: onEllipseEnd },
  highlight: { start: onHighlightStart, move: onHighlightMove, end: onHighlightEnd },
  blur: { start: onBlurStart, move: onBlurMove, end: onBlurEnd },
};

function objectBasePosition(obj: AnnotationObject): { x: number; y: number } {
  const start = obj.start ?? { x: 0, y: 0 };
  const end = obj.end ?? start;

  if (obj.type === "rect" || obj.type === "blur") {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
  }

  if (obj.type === "ellipse") {
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }

  if (obj.type === "text") {
    return start;
  }

  if (obj.type === "line" || obj.type === "arrow" || obj.type === "measure") {
    return start;
  }

  if (obj.type === "highlight") {
    return highlightBasePosition(obj);
  }

  return { x: 0, y: 0 };
}

function getNodeTransform(obj: AnnotationObject, node: Konva.Node): AnnotationObject["transform"] {
  const base = objectBasePosition(obj);
  return {
    x: node.x() - base.x,
    y: node.y() - base.y,
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
    rotation: node.rotation(),
  };
}

export function isNodeInTree(node: Konva.Node | null, root: Konva.Node | null): boolean {
  let current: Konva.Node | null = node;
  while (current) {
    if (current === root) return true;
    current = current.getParent();
  }
  return false;
}

function isTransformerNode(node: Konva.Node | null): boolean {
  return isNodeInTree(node, transformer);
}

function isEndpointEditableObject(obj: AnnotationObject | undefined): boolean {
  return obj?.type === "line" || obj?.type === "arrow" || obj?.type === "measure";
}

function editableLineHandles(obj: AnnotationObject): LineEditHandle[] {
  return obj.type === "measure" ? ["start", "end"] : ["start", "control", "end"];
}

function isEditOverlayNode(node: Konva.Node | null): boolean {
  let current: Konva.Node | null = node;
  while (current) {
    if (current.hasName(EDIT_OVERLAY_NAME)) return true;
    current = current.getParent();
  }
  return false;
}

export function cursorForAnnotationInteraction(type: "drag" | "point" | "rotate" | "resize"): string {
  if (type === "drag") return "move";
  if (type === "resize") return "nwse-resize";
  return "grab";
}

export function shouldDeselectOnEmptyClick(selectedObjectId: string | null, tool: ToolType): boolean {
  return Boolean(selectedObjectId && tool !== "text" && tool !== "eraser");
}

export function styleTransformerAnchor(anchor: Konva.Rect): string | null {
  if (!anchor.hasName("rotater")) return null;
  anchor.cornerRadius(Math.min(anchor.width(), anchor.height()) / 2);
  return cursorForAnnotationInteraction("rotate");
}

export function transformerConfigForObject(obj: AnnotationObject | undefined): {
  useTransformer: boolean;
  rotateEnabled: boolean;
  enabledAnchors: string[];
} {
  if (!obj) return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
  if (isEndpointEditableObject(obj)) return { useTransformer: false, rotateEnabled: false, enabledAnchors: [] };
  if (obj.type === "draw") return { useTransformer: true, rotateEnabled: true, enabledAnchors: [] };
  return { useTransformer: true, rotateEnabled: true, enabledAnchors: TRANSFORMER_ANCHORS };
}

function getObjectNodeFromHit(node: Konva.Node | null): Konva.Node | null {
  let current: Konva.Node | null = node;
  while (current) {
    if (isTransformerNode(current)) return null;
    if (current.id()) return current;
    if (current === layer || current === stage) return null;
    current = current.getParent();
  }
  return null;
}

function findRenderedObjectNode(id: string): Konva.Node | null {
  if (!layer || !transformer) return null;
  return layer.getChildren((node) => node !== transformer).find((node) => node.id() === id) ?? null;
}

export function shouldReplaceRenderedObject(
  prev: AnnotationObject | undefined,
  next: AnnotationObject,
): boolean {
  if (!prev) return false;
  return (
    prev.type !== next.type ||
    prev.style !== next.style ||
    prev.start !== next.start ||
    prev.end !== next.end ||
    prev.points !== next.points ||
    prev.text !== next.text
  );
}

function applyObjectTransformToNode(obj: AnnotationObject, node: Konva.Node) {
  const base = objectBasePosition(obj);
  node.x(base.x + obj.transform.x);
  node.y(base.y + obj.transform.y);
  node.scaleX(obj.transform.scaleX);
  node.scaleY(obj.transform.scaleY);
  node.rotation(obj.transform.rotation);
}

function replaceRenderedObjectNode(obj: AnnotationObject): Konva.Node | null {
  if (!layer) return null;
  const existingNode = findRenderedObjectNode(obj.id);
  const nextNode = renderObject(obj);
  const zIndex = existingNode?.zIndex();

  existingNode?.destroy();
  if (!nextNode) return null;

  layer.add(nextNode);
  if (zIndex != null) nextNode.zIndex(zIndex);
  return nextNode;
}

function setStageCursor(cursor: string) {
  const container = stage?.container();
  if (container) container.style.cursor = cursorWithColorPickerOverride(cursor);
}

function cursorWithColorPickerOverride(cursor: string): string {
  return useOverlay.getState().colorPickerVisible ? "crosshair" : cursor;
}

function toolCursor(tool = useAnnotation.getState().activeTool): string {
  switch (tool) {
    case "select": return "move";
    case "text": return "text";
    case "eraser": return "grab";
    default: return "crosshair";
  }
}

function stageCursorForTool(tool: ToolType, colorPickerVisible: boolean): string {
  return colorPickerVisible ? "crosshair" : toolCursor(tool);
}

function normalizedLayerPixelRatio(scaleFactor: number): number {
  if (!Number.isFinite(scaleFactor)) return 1;
  return Math.max(1, scaleFactor);
}

function applyLayerPixelRatio(nextLayer: Konva.Layer, scaleFactor: number) {
  const pixelRatio = normalizedLayerPixelRatio(scaleFactor);
  const sceneCanvas = nextLayer.getCanvas();
  if (sceneCanvas.getPixelRatio() === pixelRatio) return;
  sceneCanvas.setPixelRatio(pixelRatio);
  nextLayer.batchDraw();
}

function linePointWithTransform(obj: AnnotationObject, point: Point): Point {
  return {
    x: point.x + obj.transform.x,
    y: point.y + obj.transform.y,
  };
}

function lineVisualPointToObjectPoint(obj: AnnotationObject, point: Point): Point {
  return {
    x: point.x - obj.transform.x,
    y: point.y - obj.transform.y,
  };
}

function lineHandleObject(obj: AnnotationObject, handle: LineEditHandle, point: Point): AnnotationObject {
  const objectPoint = lineVisualPointToObjectPoint(obj, point);
  if (handle === "start") return { ...obj, start: objectPoint };
  if (handle === "end") return { ...obj, end: objectPoint };
  return { ...obj, points: [objectPoint.x, objectPoint.y] };
}

function lineHandlePoint(obj: AnnotationObject, handle: LineEditHandle): Point {
  if (handle === "start") return linePointWithTransform(obj, obj.start ?? { x: 0, y: 0 });
  if (handle === "end") return linePointWithTransform(obj, obj.end ?? { x: 0, y: 0 });
  return linePointWithTransform(obj, lineControlPoint(obj));
}

function clearLineEditHandles() {
  lineEditGroup?.destroy();
  lineEditGroup = null;
}

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

function createLineEditHandle(obj: AnnotationObject, handle: LineEditHandle): Konva.Circle {
  const point = lineHandlePoint(obj, handle);
  const circle = new Konva.Circle({
    x: point.x,
    y: point.y,
    radius: handle === "control" ? 5 : 6,
    fill: "#ffffff",
    stroke: "#0099ff",
    strokeWidth: 2,
    draggable: true,
    name: `${EDIT_OVERLAY_NAME} line-edit-handle line-edit-${handle}`,
  });

  circle.on("mouseenter", () => setStageCursor(cursorForAnnotationInteraction("point")));
  circle.on("mouseleave", () => setStageCursor(toolCursor()));
  circle.on("dragstart", () => setStageCursor("grabbing"));
  circle.on("dragmove", () => {
    previewLineHandleDrag(obj, handle, { x: circle.x(), y: circle.y() });
  });
  circle.on("dragend", () => {
    setStageCursor(cursorForAnnotationInteraction("point"));
    persistLineHandleDrag(obj, handle, { x: circle.x(), y: circle.y() });
  });

  return circle;
}

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

function syncSelectionWithStore(selectedObjectId = useAnnotation.getState().selectedObjectId) {
  if (!layer || !transformer) return;
  clearLineEditHandles();
  if (!selectedObjectId) {
    transformer.nodes([]);
    layer.batchDraw();
    return;
  }

  const selectedObject = useAnnotation.getState().objects.find((obj) => obj.id === selectedObjectId);
  const config = transformerConfigForObject(selectedObject);
  if (!config.useTransformer) {
    transformer.nodes([]);
    if (selectedObject && isEndpointEditableObject(selectedObject)) {
      renderLineEditHandles(selectedObject);
    }
    layer.batchDraw();
    return;
  }

  transformer.rotateEnabled(config.rotateEnabled);
  transformer.enabledAnchors(config.enabledAnchors);
  const selectedNode = findRenderedObjectNode(selectedObjectId);
  transformer.nodes(selectedNode ? [selectedNode] : []);
  transformer.moveToTop();
  layer.batchDraw();
}

function syncLayerWithStore(prevObjects: AnnotationObject[] = []) {
  if (!layer || !transformer) return;
  const { objects, selectedObjectId } = useAnnotation.getState();
  const prevById = new Map(prevObjects.map((obj) => [obj.id, obj]));
  const objectIds = new Set(objects.map((obj) => obj.id));

  transformer.nodes([]);
  layer
    .getChildren((node) => node !== transformer)
    .forEach((node) => {
      if (node.id() && !objectIds.has(node.id())) node.destroy();
    });

  for (const obj of objects) {
    const existingNode = findRenderedObjectNode(obj.id);
    const prevObj = prevById.get(obj.id);

    if (!existingNode) {
      const node = renderObject(obj);
      if (node) layer.add(node);
      continue;
    }

    if (shouldReplaceRenderedObject(prevObj, obj)) {
      replaceRenderedObjectNode(obj);
      continue;
    }

    if (prevObj?.transform !== obj.transform) {
      applyObjectTransformToNode(obj, existingNode);
    }
  }

  objects.forEach((obj, index) => {
    findRenderedObjectNode(obj.id)?.zIndex(index);
  });

  syncSelectionWithStore(selectedObjectId);
}

export function AnnotationStage({ selection, scaleFactor, interacting }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTool = useAnnotation((s) => s.activeTool);
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  const [, forceRender] = useState(0);
  const [textEditing, setTextEditing] = useState<{ position: { x: number; y: number }; editingObject: AnnotationObject | null; key: number } | null>(null);
  const textFlushRef = useRef<(() => void) | null>(null);
  const textKeyRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;

    stage = new Konva.Stage({
      container: containerRef.current,
      width: selection.width,
      height: selection.height,
    });

    layer = new Konva.Layer();
    stage.add(layer);
    applyLayerPixelRatio(layer, scaleFactor);

    transformer = new Konva.Transformer({
      rotateEnabled: true,
      rotateAnchorCursor: cursorForAnnotationInteraction("rotate"),
      borderStroke: "#0099ff",
      anchorStroke: "#0099ff",
      anchorFill: "#ffffff",
      anchorSize: 8,
      anchorStyleFunc: styleTransformerAnchor,
    });
    layer.add(transformer);

    // Handle drag end to persist position changes
    stage.on("dragend", (e) => {
      const node = getObjectNodeFromHit(e.target);
      if (!node) return;
      const { moveObject } = useAnnotation.getState();
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;
      moveObject(obj.id, getNodeTransform(obj, node));
    });

    transformer.on("transformend", () => {
      const node = transformer?.nodes()[0];
      if (!node) return;
      setStageCursor(cursorForAnnotationInteraction("drag"));
      const { resizeObject } = useAnnotation.getState();
      const obj = useAnnotation.getState().objects.find((o) => o.id === node.id());
      if (!obj) return;
      resizeObject(obj.id, { transform: getNodeTransform(obj, node) });
    });
    transformer.on("transformstart", (e) => {
      setStageCursor(isNodeInTree(e.target, transformer) ? "grabbing" : cursorForAnnotationInteraction("rotate"));
    });
    transformer.on("mouseenter", (e) => {
      const isRotater = e.target.name().includes("rotater");
      setStageCursor(cursorForAnnotationInteraction(isRotater ? "rotate" : "resize"));
    });
    transformer.on("mouseleave", () => setStageCursor(toolCursor()));

    // Existing annotations can be moved regardless of the current drawing tool.
    stage.on("dragstart", (e) => {
      if (isEditOverlayNode(e.target)) return;
      if (isTransformerNode(e.target)) return;
      const node = getObjectNodeFromHit(e.target);
      const { activeTool, setSelectedObject } = useAnnotation.getState();
      if (!node || activeTool === "eraser") {
        e.target.stopDrag();
        return;
      }
      setStageCursor("grabbing");
      setSelectedObject(node.id());
      transformer?.nodes([node]);
      transformer?.moveToTop();
      getLayer()?.batchDraw();
    });
    stage.on("dragend", () => setStageCursor(cursorForAnnotationInteraction("drag")));
    stage.on("mousemove", (e) => {
      if (useAnnotation.getState().drawingState === "active") return;
      if (isEditOverlayNode(e.target)) {
        setStageCursor(cursorForAnnotationInteraction("point"));
        return;
      }
      if (isTransformerNode(e.target)) {
        const isRotater = e.target.name().includes("rotater");
        setStageCursor(cursorForAnnotationInteraction(isRotater ? "rotate" : "resize"));
        return;
      }
      const node = getObjectNodeFromHit(e.target);
      const obj = node ? useAnnotation.getState().objects.find((o) => o.id === node.id()) : undefined;
      if (obj && !isEndpointEditableObject(obj) && useAnnotation.getState().activeTool !== "eraser") {
        setStageCursor(cursorForAnnotationInteraction("drag"));
        return;
      }
      setStageCursor(toolCursor());
    });
    stage.on("mouseleave", () => setStageCursor(toolCursor()));

    forceRender((n) => n + 1);

    return () => {
      stage?.destroy();
      stage = null;
      layer = null;
      transformer = null;
      lineEditGroup = null;
    };
  }, []);

  useEffect(() => {
    if (!stage || interacting) return;
    stage.width(selection.width);
    stage.height(selection.height);
    if (layer) applyLayerPixelRatio(layer, scaleFactor);
    stage.batchDraw();
  }, [selection.width, selection.height, scaleFactor, interacting]);

  // Sync Konva layer with store objects and selection (handles undo/redo/style/transform)
  useEffect(() => {
    return useAnnotation.subscribe((state, prev) => {
      if (state.objects !== prev.objects) {
        syncLayerWithStore(prev.objects);
        return;
      }
      if (state.selectedObjectId !== prev.selectedObjectId) {
        syncSelectionWithStore(state.selectedObjectId);
      }
    });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Let resize handle clicks pass through to overlay
    if (hitTestHandle({ x: e.clientX, y: e.clientY }, selection, 10)) return;

    const { activeTool: tool, objects, selectedObjectId, setSelectedObject, setDrawingState } = useAnnotation.getState();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const stageInst = getStage();
    const hitTarget = stageInst?.getIntersection({ x, y }) ?? null;
    if (isEditOverlayNode(hitTarget)) {
      e.stopPropagation();
      return;
    }
    if (isTransformerNode(hitTarget)) {
      e.stopPropagation();
      return;
    }
    const hitNode = getObjectNodeFromHit(hitTarget);
    const hitObject = hitNode ? objects.find((o) => o.id === hitNode.id()) : undefined;

    // Keep single-click available for selecting/dragging text. Double-click reopens editing.
    if (tool === "text" && hitObject?.type === "text" && hitNode && e.detail >= 2) {
      e.stopPropagation();
      hitNode.destroy();
      getLayer()?.batchDraw();
      useAnnotation.getState().deleteObject(hitObject.id);
      textKeyRef.current++;
      setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: hitObject, key: textKeyRef.current });
      return;
    }

    // Smart click-to-select: check if clicking on existing object
    if (tool !== "eraser" && hitObject && hitNode) {
      e.stopPropagation();
      setSelectedObject(hitObject.id);
      return;
    }

    if (tool === "select") {
      setSelectedObject(null);
      if (transformer) {
        transformer.nodes([]);
        getLayer()?.batchDraw();
      }
      return;
    }

    // Prevent overlay from interpreting annotation tool clicks as move/drag.
    e.stopPropagation();

    if (shouldDeselectOnEmptyClick(selectedObjectId, tool)) {
      setSelectedObject(null);
      return;
    }

    // Text tool handled separately (no drag)
    if (tool === "text") {
      // If already editing text, confirm it at its original position first
      if (textEditing && textFlushRef.current) {
        textFlushRef.current();
      }
      textKeyRef.current++;
      setTextEditing({ position: { x: e.clientX, y: e.clientY }, editingObject: null, key: textKeyRef.current });
      return;
    }

    // Eraser
    if (tool === "eraser") {
      setDrawingState("active");
      onEraserStart(x, y);
      return;
    }

    // Start drawing with current tool
    const handlers = TOOL_HANDLERS[tool];
    if (handlers) {
      setDrawingState("active");
      handlers.start(x, y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { activeTool: tool, drawingState } = useAnnotation.getState();
    if (drawingState !== "active") return;

    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "eraser") {
      onEraserMove(x, y);
      return;
    }

    const handlers = TOOL_HANDLERS[tool];
    if (handlers) handlers.move(x, y);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const { activeTool: tool, drawingState, setDrawingState, addObject } = useAnnotation.getState();
    if (drawingState !== "active") return;

    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "eraser") {
      onEraserEnd();
      setDrawingState("idle");
      return;
    }

    const handlers = TOOL_HANDLERS[tool];
    if (handlers) {
      const obj = handlers.end(x, y);
      if (obj) addObject(obj);
    }
    setDrawingState("idle");
  };

  const cursor = stageCursorForTool(activeTool, colorPickerVisible);

  return (
    <>
      <div
        ref={containerRef}
        data-annotation-stage
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: "absolute",
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height,
          cursor,
          pointerEvents: interacting ? "none" : "auto",
          visibility: "visible",
        }}
      />
      {textEditing && (
        <TextOverlay
          key={textEditing.key}
          position={textEditing.position}
          selection={selection}
          editingObject={textEditing.editingObject}
          flushRef={textFlushRef}
          onConfirm={(obj) => {
            addTextToLayer(obj);
            useAnnotation.getState().addObject(obj);
            setTextEditing(null);
          }}
          onCancel={() => setTextEditing(null)}
        />
      )}
    </>
  );
}
