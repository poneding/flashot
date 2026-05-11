/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "@/overlay/Toolbar";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  cropAndCopy: vi.fn(),
  cropAndSave: vi.fn(),
  cancelCapture: vi.fn(),
}));

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

describe("Toolbar", () => {
  beforeEach(() => {
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 100, width: 240, height: 160 });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders screenshot actions as icon-only buttons with hover titles", () => {
    render(<Toolbar />);

    const copy = screen.getByRole("button", { name: "Copy" });
    const save = screen.getByRole("button", { name: "Save As" });
    const close = screen.getByRole("button", { name: "Close" });

    expect(copy.textContent).toBe("");
    expect(save.textContent).toBe("");
    expect(close.textContent).toBe("");
    expect(screen.queryByText("Copy")).toBeNull();

    fireEvent.mouseEnter(copy);

    expect(screen.getByRole("tooltip").textContent).toBe("Copy");
  });
});
