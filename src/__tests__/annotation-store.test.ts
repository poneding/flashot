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

  it("keeps line and arrow line styles independent when switching tools", () => {
    useAnnotation.getState().setActiveTool("line");
    useAnnotation.getState().setActiveStyle({ lineShape: "wavy", lineStyle: "solid" });

    useAnnotation.getState().setActiveTool("arrow");
    useAnnotation.getState().setActiveStyle({ lineStyle: "dashed" });

    expect(useAnnotation.getState().activeStyle.lineStyle).toBe("dashed");

    useAnnotation.getState().setActiveTool("line");

    expect(useAnnotation.getState().activeStyle.lineShape).toBe("wavy");
    expect(useAnnotation.getState().activeStyle.lineStyle).toBe("solid");
  });

  it("keeps measure color and stroke width independent from other tools", () => {
    useAnnotation.getState().setActiveStyle({ color: "#0099ff", strokeWidth: 6 });
    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ color: "#ffcc00", strokeWidth: 2 });

    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ color: "#33cc33", strokeWidth: 12 });

    useAnnotation.getState().setActiveTool("measure");

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(2);
    expect(useAnnotation.getState().activeStyle.color).toBe("#ffcc00");
  });

  it("stores measure color and stroke width separately from the shared annotation style", () => {
    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ color: "#0099ff", strokeWidth: 2 });

    const stored = JSON.parse(localStorage.getItem("flashot:annotation-tool-style") ?? "{}");

    expect(stored.measure).toEqual({ color: "#0099ff", strokeWidth: 2 });
  });

  it("keeps highlight stroke width and corner radius independent from other tools", () => {
    useAnnotation.getState().setActiveStyle({ strokeWidth: 6, cornerRadius: 4 });
    useAnnotation.getState().setActiveTool("highlight");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 2, cornerRadius: 16 });

    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 12, cornerRadius: 32 });

    useAnnotation.getState().setActiveTool("highlight");

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(2);
    expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(16);
  });

  it("stores highlight stroke width and corner radius separately", () => {
    useAnnotation.getState().setActiveTool("highlight");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 2, cornerRadius: 16 });

    const stored = JSON.parse(localStorage.getItem("flashot:annotation-tool-style") ?? "{}");

    expect(stored.highlight).toEqual({ strokeWidth: 2, cornerRadius: 16 });
  });

  it("normalizes legacy handwriting font values to system-ui", () => {
    useAnnotation.getState().setActiveStyle({ fontFamily: "Excalifont" });

    expect(useAnnotation.getState().activeStyle.fontFamily).toBe("system-ui");
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
