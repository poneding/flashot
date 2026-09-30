/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePinToolBounds } from "@/pin/usePinToolBounds";
import { resizePinToolWindow } from "@/lib/ipc";

vi.mock("@/lib/ipc", () => ({ resizePinToolWindow: vi.fn().mockResolvedValue({ side: "right" }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function HiddenPalette({ ready }: { ready: boolean }) {
  const { setRoot, offset } = usePinToolBounds("one", "editor");
  return <div ref={setRoot} data-pin-tool-origin style={{ position: "absolute", ...offset }}>
    {ready && <div data-annotation-toolbar />}
  </div>;
}

it("reports a lazy palette's initial bounds even while a hidden webview suspends animation frames", async () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { x: 6, y: 6, left: 6, top: 6, right: 546, bottom: 46, width: 540, height: 40, toJSON() {} } as DOMRect;
  });
  const view = render(<HiddenPalette ready={false} />);
  expect(resizePinToolWindow).not.toHaveBeenCalled();
  view.rerender(<HiddenPalette ready />);
  await waitFor(() => expect(resizePinToolWindow).toHaveBeenCalledWith("one", "editor", {
    width: 540, height: 40, anchorX: 0, anchorY: 0, anchorWidth: 540, anchorHeight: 40,
  }));
});
