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
