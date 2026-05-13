import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import type { Rect } from "@/lib/types";
import { useAnnotation } from "@/annotation/store";
import { onDrawStart, onDrawMove, onDrawEnd } from "@/annotation/tools/draw";
import { onLineStart, onLineMove, onLineEnd } from "@/annotation/tools/line";
import { onRectStart, onRectMove, onRectEnd } from "@/annotation/tools/rect";
import { onEllipseStart, onEllipseMove, onEllipseEnd } from "@/annotation/tools/ellipse";
import { onHighlightStart, onHighlightMove, onHighlightEnd } from "@/annotation/tools/highlight";
import { onBlurStart, onBlurMove, onBlurEnd } from "@/annotation/tools/blur";
import { onEraserStart, onEraserMove, onEraserEnd } from "@/annotation/tools/eraser";
import type { AnnotationObject, ToolType } from "@/annotation/types";

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

type ToolHandlers = {
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => AnnotationObject | null;
};

const TOOL_HANDLERS: Partial<Record<ToolType, ToolHandlers>> = {
  draw: { start: onDrawStart, move: onDrawMove, end: (_x, _y) => onDrawEnd() },
  line: { start: onLineStart, move: onLineMove, end: onLineEnd },
  rect: { start: onRectStart, move: onRectMove, end: onRectEnd },
  ellipse: { start: onEllipseStart, move: onEllipseMove, end: onEllipseEnd },
  highlight: { start: onHighlightStart, move: onHighlightMove, end: onHighlightEnd },
  blur: { start: onBlurStart, move: onBlurMove, end: onBlurEnd },
};

export function AnnotationStage({ selection, scaleFactor: _scaleFactor }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTool = useAnnotation((s) => s.activeTool);
  const [, forceRender] = useState(0);

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

    forceRender((n) => n + 1);

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

  const handleMouseDown = (e: React.MouseEvent) => {
    const { activeTool: tool, objects, setSelectedObject, setDrawingState } = useAnnotation.getState();
    const rect = containerRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Smart click-to-select: check if clicking on existing object
    if (tool !== "eraser") {
      const stageInst = getStage();
      const shape = stageInst?.getIntersection({ x, y });
      if (shape && shape.id() && shape.id() !== transformer?.id()) {
        const obj = objects.find((o) => o.id === shape.id());
        if (obj) {
          setSelectedObject(obj.id);
          if (transformer) {
            transformer.nodes([shape]);
            getLayer()?.batchDraw();
          }
          return;
        }
      }
    }

    // Deselect if select tool and clicking empty
    if (tool === "select") {
      setSelectedObject(null);
      if (transformer) {
        transformer.nodes([]);
        getLayer()?.batchDraw();
      }
      return;
    }

    // Text tool handled separately (no drag)
    if (tool === "text") {
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

  const cursor =
    activeTool === "select"
      ? "default"
      : activeTool === "text"
        ? "text"
        : "crosshair";

  return (
    <div
      ref={containerRef}
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
        pointerEvents: "auto",
      }}
    />
  );
}
