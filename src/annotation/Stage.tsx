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

export function AnnotationStage({ selection, scaleFactor: _scaleFactor }: Props) {
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
