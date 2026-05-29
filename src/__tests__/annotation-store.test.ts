import { describe, it, expect, beforeEach } from "vitest";
import { useAnnotation } from "@/annotation/store";
import { DEFAULT_STYLE } from "@/annotation/types";
import type { AnnotationObject, ToolType } from "@/annotation/types";

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

  it("defaults shape fill styling to hollow without configurable focus settings", () => {
    expect(DEFAULT_STYLE.fill).toBe("hollow");
    expect(DEFAULT_STYLE.focusMode).toBeUndefined();
    expect(DEFAULT_STYLE.focusOpacity).toBeUndefined();
    expect(DEFAULT_STYLE.focusColor).toBeUndefined();
  });

  it("normalizes legacy focus mode into the spotlight fill option", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ focusMode: "spotlight" });

    expect(useAnnotation.getState().activeStyle.fill).toBe("spotlight");
    expect(useAnnotation.getState().activeStyle.focusMode).toBeUndefined();
    expect(useAnnotation.getState().activeStyle.focusOpacity).toBeUndefined();
    expect(useAnnotation.getState().activeStyle.focusColor).toBeUndefined();
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

  it("stores measure color, stroke width, and mode separately from the shared annotation style", () => {
    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ color: "#0099ff", strokeWidth: 2, measureMode: "axis" });

    const stored = JSON.parse(localStorage.getItem("flashot:annotation-tool-style") ?? "{}");

    expect(stored.measure).toEqual({ color: "#0099ff", strokeWidth: 2, measureMode: "axis" });
  });

  it("normalizes magnifier zoom to the 200%-400% range", () => {
    useAnnotation.getState().setActiveTool("magnifier");

    useAnnotation.getState().setActiveStyle({ magnifierZoom: 1.5 });
    expect(useAnnotation.getState().activeStyle.magnifierZoom).toBe(2);

    useAnnotation.getState().setActiveStyle({ magnifierZoom: 4.5 });
    expect(useAnnotation.getState().activeStyle.magnifierZoom).toBe(4);
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

  it("does not leak highlight stroke width or corner radius into other tool defaults", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 8, cornerRadius: 10 });

    useAnnotation.getState().setActiveTool("measure");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 9 });

    useAnnotation.getState().setActiveTool("highlight");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 2, cornerRadius: 16 });

    const sharedTools: ToolType[] = ["rect", "line", "arrow", "draw"];
    for (const tool of sharedTools) {
      useAnnotation.getState().setActiveTool(tool);
      expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(8);
      expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(10);
    }

    useAnnotation.getState().setActiveTool("measure");

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(9);
    expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(10);

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

  it("allocates marker numbers sequentially within a session", () => {
    expect(useAnnotation.getState().currentMarkerNumber).toBe(1);
    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(1);
    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(2);
    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(3);
    expect(useAnnotation.getState().currentMarkerNumber).toBe(4);
  });

  it("deleting a marker decrements only the current marker counter", () => {
    const marker = (id: string, markerNumber: number): AnnotationObject => ({
      id,
      type: "marker",
      start: { x: markerNumber * 10, y: 20 },
      markerNumber,
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    });

    useAnnotation.getState().addObject(marker("marker-1", useAnnotation.getState().allocateMarkerNumber()));
    useAnnotation.getState().addObject(marker("marker-2", useAnnotation.getState().allocateMarkerNumber()));
    useAnnotation.getState().addObject(marker("marker-3", useAnnotation.getState().allocateMarkerNumber()));

    useAnnotation.getState().deleteObject("marker-2");

    expect(useAnnotation.getState().currentMarkerNumber).toBe(3);
    expect(useAnnotation.getState().objects.map((obj) => obj.markerNumber)).toEqual([1, 3]);
  });

  it("sets the current marker number for the next marker", () => {
    useAnnotation.getState().setCurrentMarkerNumber(7);

    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(7);
    expect(useAnnotation.getState().currentMarkerNumber).toBe(8);

    useAnnotation.getState().setCurrentMarkerNumber(0);
    expect(useAnnotation.getState().currentMarkerNumber).toBe(0);
    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(0);
    expect(useAnnotation.getState().currentMarkerNumber).toBe(1);
  });

  it("caps marker numbering at 99", () => {
    useAnnotation.getState().setCurrentMarkerNumber(120);

    expect(useAnnotation.getState().currentMarkerNumber).toBe(99);
    expect(useAnnotation.getState().allocateMarkerNumber()).toBe(99);
    expect(useAnnotation.getState().currentMarkerNumber).toBe(99);
  });

  it("uses 14 as the default marker font size", () => {
    useAnnotation.getState().setActiveTool("marker");

    expect(useAnnotation.getState().activeStyle.fontSize).toBe(14);
  });

  it("does not decrement marker numbering below zero", () => {
    const marker: AnnotationObject = {
      id: "marker-0",
      type: "marker",
      start: { x: 10, y: 20 },
      markerNumber: 0,
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setCurrentMarkerNumber(0);
    useAnnotation.getState().addObject(marker);

    useAnnotation.getState().deleteObject("marker-0");

    expect(useAnnotation.getState().currentMarkerNumber).toBe(0);
  });

  it("resets marker numbering for a new capture session", () => {
    useAnnotation.getState().allocateMarkerNumber();
    useAnnotation.getState().setCurrentMarkerNumber(12);

    useAnnotation.getState().reset();

    expect(useAnnotation.getState().currentMarkerNumber).toBe(1);
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
