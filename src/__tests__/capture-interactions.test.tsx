import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AnnotationStage, getLayer, getStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import { createCommandStack } from "@/annotation/commands";
import { PinRoute } from "@/routes/Pin";
import { setPinScale } from "@/lib/ipc";

vi.mock("@/lib/ipc", () => ({
  beginTextInputSession: vi.fn().mockResolvedValue(undefined),
  endTextInputSession: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({ accentColor: "#F59E0B", language: "en", theme: "system" }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  closePin: vi.fn().mockResolvedValue(undefined),
  copyPin: vi.fn().mockResolvedValue(undefined),
  savePin: vi.fn().mockResolvedValue(undefined),
  updatePinAnnotation: vi.fn().mockResolvedValue(undefined),
  setPinScale: vi.fn().mockImplementation(async (_id, scale) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 * scale + 96 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 * scale + 96 });
    window.dispatchEvent(new Event("resize"));
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));
vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: vi.fn().mockResolvedValue("/cache") }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ startDragging: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock("@/annotation/Toolbar", () => ({ Toolbar: () => <div /> }));

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function(this: HTMLCanvasElement) {
    const context = { canvas: this, measureText: vi.fn(() => ({ width: 40 })), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) })), createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })), createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })), createPattern: vi.fn(() => null) };
    return new Proxy(context, { get(target, prop) { return prop in target ? target[prop as keyof typeof target] : vi.fn(); } }) as any;
  });
});
beforeEach(() => {
  useAnnotation.getState().reset();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 496 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 396 });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  vi.mocked(setPinScale).mockClear();
});
afterEach(() => { cleanup(); useAnnotation.getState().reset(); window.location.hash = ""; });
const rect = (id: string) => ({ id, type: "rect" as const, start: { x: 100, y: 80 }, end: { x: 180, y: 140 }, style: { color: "#ff0000", strokeWidth: 4 }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } });

it("undo deletion restores the original stacking order", () => {
  const back = rect("background"), front = rect("foreground");
  const stack = createCommandStack();
  const remaining = stack.execute({ type: "delete", objectId: back.id, before: back, after: {} }, [back, front]);
  expect(stack.undo(remaining).map(o => o.id)).toEqual(["background", "foreground"]);
});

it("releasing a drawing outside the selection finishes the gesture", () => {
  useAnnotation.getState().setActiveTool("draw");
  const view = render(<div data-testid="outside"><AnnotationStage selection={{ x: 100, y: 100, width: 240, height: 160 }} scaleFactor={1} /></div>);
  const stage = view.container.querySelector("[data-annotation-stage]")!;
  fireEvent.mouseDown(stage, { clientX: 160, clientY: 160, button: 0 });
  expect(useAnnotation.getState().drawingState).toBe("active");
  fireEvent.mouseUp(view.getByTestId("outside"), { clientX: 400, clientY: 400, button: 0 });
  expect(useAnnotation.getState().drawingState).toBe("idle");
});

async function openPinEditor() {
  window.location.hash = "#/pin/audit-pin";
  const view = render(<PinRoute />);
  await view.findByAltText("Pinned screenshot");
  fireEvent.keyDown(window, { key: "e" });
  await vi.waitFor(() => expect(view.container.querySelector("[data-annotation-stage]")).not.toBeNull());
  act(() => { useAnnotation.getState().addObject(rect("annotation")); useAnnotation.getState().setSelectedObject("annotation"); });
  return view;
}

it("resizing an annotation with the wheel does not also zoom the pin", async () => {
  const view = await openPinEditor();
  const stage = view.container.querySelector("[data-annotation-stage]")!;
  const before = useAnnotation.getState().objects[0].style.strokeWidth;
  fireEvent.wheel(stage, { deltaY: -100, deltaMode: 0 });
  expect(useAnnotation.getState().objects[0].style.strokeWidth).toBeGreaterThan(before);
  expect(setPinScale).not.toHaveBeenCalled();
});

it("zooming a pin preserves an annotation's position relative to its image", async () => {
  const view = await openPinEditor();
  const xBefore = getLayer()!.findOne("#annotation")!.x();
  const widthBefore = getStage()!.width();
  fireEvent.keyDown(window, { key: "+", metaKey: true });
  await vi.waitFor(() => expect((view.container.querySelector("[data-annotation-stage]") as HTMLElement).style.transform).toBe("scale(1.05)"));
  const xAfter = getLayer()!.findOne("#annotation")!.x();
  expect(xAfter * 1.05 / 420).toBeCloseTo(xBefore / widthBefore, 5);
});

it("cancelling an existing text edit restores the original annotation", async () => {
  useAnnotation.getState().setActiveTool("text");
  const view = render(<AnnotationStage selection={{ x: 100, y: 100, width: 240, height: 160 }} scaleFactor={1} />);
  const original = { id: "text-original", type: "text" as const, start: { x: 30, y: 30 }, text: "keep this text", style: { color: "#ff0000", strokeWidth: 4, fontSize: 24 }, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } };
  act(() => useAnnotation.getState().addObject(original));
  vi.spyOn(getStage()!, "getIntersection").mockReturnValue(getLayer()!.findOne("#text-original") as any);
  fireEvent.mouseDown(view.container.querySelector("[data-annotation-stage]")!, { clientX: 160, clientY: 160, button: 0, detail: 2 });
  const textarea = view.container.querySelector("textarea")!;
  expect(textarea).not.toBeNull();
  fireEvent.keyDown(textarea, { key: "Escape" });
  expect(useAnnotation.getState().objects.map(o => o.text)).toEqual(["keep this text"]);
});
