/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PinResizeHandles } from "@/pin/PinResizeHandles";
import { beginPinResize, endPinResize, resizePin } from "@/lib/ipc";

vi.mock("@/lib/ipc", () => ({
  beginPinResize: vi.fn().mockResolvedValue("gesture-1"),
  resizePin: vi.fn().mockResolvedValue(1.25),
  endPinResize: vi.fn().mockResolvedValue(undefined),
}));

function pointer(node: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, screenX: x, screenY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(node, event);
}

describe("pin edge resizing", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("resizes from the selected corner using screen deltas and finishes its native session", async () => {
    const onScale = vi.fn();
    const onResizingChange = vi.fn();
    const drag = vi.fn();
    render(<div onPointerDown={drag}><PinResizeHandles pinId="pin" onScale={onScale} onResizingChange={onResizingChange} /></div>);
    const edge = screen.getByTestId("pin-resize-NorthWest");
    pointer(edge, "pointerdown", 200, 200);
    pointer(edge, "pointermove", 160, 180);
    pointer(edge, "pointerup", 150, 175);
    await waitFor(() => expect(endPinResize).toHaveBeenCalledWith("pin", "gesture-1"));
    expect(beginPinResize).toHaveBeenCalledWith("pin", "NorthWest");
    expect(resizePin).toHaveBeenLastCalledWith("pin", "gesture-1", -50, -25);
    expect(onScale).toHaveBeenLastCalledWith(1.25);
    expect(onResizingChange.mock.calls).toEqual([[true], [false]]);
    expect(drag).not.toHaveBeenCalled();
  });

  it("preserves the final drag when mouseup happens before native initialization completes", async () => {
    let ready!: (token: string) => void;
    vi.mocked(beginPinResize).mockReturnValueOnce(new Promise(resolve => { ready = resolve; }));
    render(<PinResizeHandles pinId="pin" onScale={vi.fn()} onResizingChange={vi.fn()} />);
    const edge = screen.getByTestId("pin-resize-East");
    pointer(edge, "pointerdown", 100, 100);
    pointer(edge, "pointerup", 145, 100);
    await act(async () => ready("late-gesture"));
    await waitFor(() => expect(endPinResize).toHaveBeenCalledWith("pin", "late-gesture"));
    expect(resizePin).toHaveBeenCalledWith("pin", "late-gesture", 45, 0);
  });

  it("ends an active resize if its image window unmounts", async () => {
    const view = render(<PinResizeHandles pinId="pin" onScale={vi.fn()} onResizingChange={vi.fn()} />);
    pointer(screen.getByTestId("pin-resize-South"), "pointerdown", 100, 100);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    await waitFor(() => expect(endPinResize).toHaveBeenCalledWith("pin", "gesture-1"));
  });
});
