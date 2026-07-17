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

  it("keeps spotlight styling scoped to the standalone spotlight tool", () => {
    useAnnotation.getState().setActiveTool("spotlight");

    expect(useAnnotation.getState().activeStyle.fill).toBe("spotlight");
    expect(useAnnotation.getState().activeStyle.spotlightShape).toBe("rect");

    useAnnotation.getState().setActiveStyle({ spotlightShape: "circle" });
    useAnnotation.getState().setActiveTool("rect");

    expect(useAnnotation.getState().activeStyle.fill).toBe("hollow");

    useAnnotation.getState().setActiveTool("spotlight");

    expect(useAnnotation.getState().activeStyle.fill).toBe("spotlight");
    expect(useAnnotation.getState().activeStyle.spotlightShape).toBe("circle");
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

  it("updateSelectedStyle updates both selected object and default style", () => {
    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");
    useAnnotation.getState().updateSelectedStyle({ strokeWidth: 10, color: "#00ff00" });

    const updatedObj = useAnnotation.getState().objects.find(o => o.id === "1");
    expect(updatedObj?.style.strokeWidth).toBe(10);
    expect(updatedObj?.style.color).toBe("#00ff00");
    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(10);
    expect(useAnnotation.getState().activeStyle.color).toBe("#00ff00");
  });

  it("updateSelectedStyle with no selection only updates default style", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().updateSelectedStyle({ strokeWidth: 8, color: "#0000ff" });

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(8);
    expect(useAnnotation.getState().activeStyle.color).toBe("#0000ff");
  });

  it("new annotations use style remembered from selected annotation", () => {
    const obj = {
      id: "1",
      type: "line" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4, lineStyle: "solid" as const },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setActiveTool("line");
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");
    useAnnotation.getState().updateSelectedStyle({ strokeWidth: 12 });

    const newObj = {
      id: "2",
      type: "line" as const,
      start: { x: 200, y: 200 },
      end: { x: 300, y: 300 },
      style: { ...useAnnotation.getState().activeStyle },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(newObj);

    expect(useAnnotation.getState().objects[1].style.strokeWidth).toBe(12);
  });

  it("setSelectedObject pre-fills activeStyle from selected annotation", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ strokeWidth: 4, cornerRadius: 8 });

    const obj = {
      id: "1",
      type: "rect" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 10, cornerRadius: 20 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(10);
    expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(20);
  });

  it("keeps every drawing tool style isolated from cross-type selection", () => {
    const drawingTools: ToolType[] = [
      "draw",
      "line",
      "measure",
      "arrow",
      "rect",
      "ellipse",
      "text",
      "blur",
      "highlight",
      "spotlight",
      "marker",
      "magnifier",
    ];

    for (const tool of drawingTools) {
      useAnnotation.getState().reset();
      useAnnotation.getState().setActiveTool(tool);
      useAnnotation.getState().setActiveStyle({
        color: "#123456",
        strokeWidth: 7,
        fill: tool === "spotlight" ? "spotlight" : "hollow",
        lineShape: "straight",
        lineStyle: "dotted",
        arrow: "none",
        fontSize: 23,
        blurMode: "mosaic",
        spotlightShape: "rect",
        magnifierZoom: 2.5,
      });
      const beforeSelection = { ...useAnnotation.getState().activeStyle };
      const selectedObject: AnnotationObject = {
        id: `selected-by-${tool}`,
        type: tool === "spotlight" ? "rect" : "spotlight",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        style: {
          ...DEFAULT_STYLE,
          color: "#abcdef",
          strokeWidth: 19,
          fill: "spotlight",
          lineShape: "wavy",
          lineStyle: "dashed",
          arrow: "both",
          fontSize: 71,
          blurMode: "gaussian",
          spotlightShape: "circle",
          magnifierZoom: 4,
        },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      };

      useAnnotation.getState().addObject(selectedObject);
      useAnnotation.getState().setSelectedObject(selectedObject.id);

      expect(useAnnotation.getState().activeTool).toBe(tool);
      expect(useAnnotation.getState().activeStyle).toEqual(beforeSelection);
    }
  });

  it("edits a cross-type selected object without changing the active drawing style", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({
      color: "#123456",
      strokeWidth: 7,
      fill: "hollow",
      cornerRadius: 12,
    });
    const rectangleStyle = { ...useAnnotation.getState().activeStyle };
    const spotlight: AnnotationObject = {
      id: "spotlight-1",
      type: "spotlight",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { ...DEFAULT_STYLE, fill: "spotlight", spotlightShape: "rect" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(spotlight);
    useAnnotation.getState().setSelectedObject(spotlight.id);

    useAnnotation.getState().updateSelectedStyle({
      spotlightShape: "circle",
      cornerRadius: 24,
    });

    const updatedSpotlight = useAnnotation.getState().objects.find((object) => object.id === spotlight.id);
    expect(updatedSpotlight?.style.spotlightShape).toBe("circle");
    expect(updatedSpotlight?.style.cornerRadius).toBe(24);
    expect(useAnnotation.getState().activeStyle).toEqual(rectangleStyle);
  });

  it.each(["rect", "ellipse"] as const)(
    "does not seed the %s tool with a legacy spotlight fill",
    (tool) => {
      useAnnotation.getState().setActiveTool(tool);
      const legacySpotlightShape: AnnotationObject = {
        id: `legacy-${tool}-spotlight`,
        type: tool,
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        style: { ...DEFAULT_STYLE, fill: "spotlight" },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
      };
      useAnnotation.getState().addObject(legacySpotlightShape);

      useAnnotation.getState().setSelectedObject(legacySpotlightShape.id);

      expect(useAnnotation.getState().activeStyle.fill).toBe("hollow");
    },
  );

  it("does not carry a selected arrow style into a different tool from select mode", () => {
    useAnnotation.getState().setActiveTool("rect");
    useAnnotation.getState().setActiveStyle({ color: "#123456", arrow: "none" });
    useAnnotation.getState().setActiveTool("select");
    const arrow: AnnotationObject = {
      id: "arrow-1",
      type: "arrow",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { ...DEFAULT_STYLE, color: "#abcdef", arrow: "end" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(arrow);
    useAnnotation.getState().setSelectedObject(arrow.id);

    useAnnotation.getState().setActiveTool("line");

    expect(useAnnotation.getState().activeStyle.color).toBe("#123456");
    expect(useAnnotation.getState().activeStyle.arrow).toBe("none");
  });

  it("clears an arrow endpoint when switching directly from arrow to line", () => {
    useAnnotation.getState().setActiveTool("arrow");
    expect(useAnnotation.getState().activeStyle.arrow).toBe("end");

    useAnnotation.getState().setActiveTool("line");

    expect(useAnnotation.getState().activeStyle.arrow).toBe("none");
  });

  it("keeps line and arrow endpoint semantics stable when styles are updated", () => {
    useAnnotation.getState().setActiveTool("line");
    useAnnotation.getState().setActiveStyle({ arrow: "both" });
    expect(useAnnotation.getState().activeStyle.arrow).toBe("none");

    useAnnotation.getState().setActiveTool("arrow");
    useAnnotation.getState().setActiveStyle({ arrow: "none" });
    expect(useAnnotation.getState().activeStyle.arrow).toBe("end");
  });

  it("updateSelectedStyle updates selected object and remembers style for next annotation", () => {
    const obj = {
      id: "1",
      type: "line" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4, lineStyle: "solid" as const },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setActiveTool("line");
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");

    useAnnotation.getState().updateSelectedStyle({ strokeWidth: 10, color: "#00ff00" });

    const updatedObj = useAnnotation.getState().objects.find(o => o.id === "1");
    expect(updatedObj?.style.strokeWidth).toBe(10);
    expect(updatedObj?.style.color).toBe("#00ff00");

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(10);
    expect(useAnnotation.getState().activeStyle.color).toBe("#00ff00");

    const newObj = {
      id: "2",
      type: "line" as const,
      start: { x: 200, y: 200 },
      end: { x: 300, y: 300 },
      style: { ...useAnnotation.getState().activeStyle },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().addObject(newObj);

    expect(useAnnotation.getState().objects[1].style.strokeWidth).toBe(10);
    expect(useAnnotation.getState().objects[1].style.color).toBe("#00ff00");
  });

  it("updateSelectedStyle applies to blur mode changes", () => {
    const obj = {
      id: "1",
      type: "blur" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ff0000", strokeWidth: 4, blurMode: "mosaic" as const, blurIntensity: 10 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setActiveTool("blur");
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");

    useAnnotation.getState().updateSelectedStyle({ blurMode: "gaussian", blurIntensity: 20 });

    const updatedObj = useAnnotation.getState().objects.find(o => o.id === "1");
    expect(updatedObj?.style.blurMode).toBe("gaussian");
    expect(updatedObj?.style.blurIntensity).toBe(20);

    expect(useAnnotation.getState().activeStyle.blurMode).toBe("gaussian");
    expect(useAnnotation.getState().activeStyle.blurIntensity).toBe(20);
  });

  it("updateSelectedStyle applies to marker fill changes", () => {
    const obj = {
      id: "1",
      type: "marker" as const,
      start: { x: 100, y: 100 },
      markerNumber: 1,
      style: { color: "#ff0000", strokeWidth: 4, markerFill: "#ff0000", fontSize: 14 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setActiveTool("marker");
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");

    useAnnotation.getState().updateSelectedStyle({ markerFill: "#00ff00", fontSize: 18 });

    const updatedObj = useAnnotation.getState().objects.find(o => o.id === "1");
    expect(updatedObj?.style.markerFill).toBe("#00ff00");
    expect(updatedObj?.style.fontSize).toBe(18);

    expect(useAnnotation.getState().activeStyle.markerFill).toBe("#00ff00");
    expect(useAnnotation.getState().activeStyle.fontSize).toBe(18);
  });

  it("updateSelectedStyle applies to highlight intensity changes", () => {
    const obj = {
      id: "1",
      type: "highlight" as const,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      style: { color: "#ffff00", strokeWidth: 12, cornerRadius: 8 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    useAnnotation.getState().setActiveTool("highlight");
    useAnnotation.getState().addObject(obj);
    useAnnotation.getState().setSelectedObject("1");

    useAnnotation.getState().updateSelectedStyle({ strokeWidth: 20, cornerRadius: 16 });

    const updatedObj = useAnnotation.getState().objects.find(o => o.id === "1");
    expect(updatedObj?.style.strokeWidth).toBe(20);
    expect(updatedObj?.style.cornerRadius).toBe(16);

    expect(useAnnotation.getState().activeStyle.strokeWidth).toBe(20);
    expect(useAnnotation.getState().activeStyle.cornerRadius).toBe(16);
  });
});
