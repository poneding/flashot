/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "@/overlay/Toolbar";
import { useOverlay } from "@/overlay/state";
import type { CaptureStartPayload } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  cropAndCopy: vi.fn(),
  cropAndSave: vi.fn(),
  cancelCapture: vi.fn(),
  pinImage: vi.fn(),
}));

const capture: CaptureStartPayload = {
  monitorId: 1,
  frameUrl: "asset://localhost/frame.png",
  monitorRect: { x: 0, y: 0, width: 800, height: 600 },
  scaleFactor: 2,
  windows: [],
};

describe("Toolbar", () => {
  const onCopy = vi.fn();
  const onSave = vi.fn();
  const onPin = vi.fn();
  const onClose = vi.fn();
  const onScroll = vi.fn();
  const onOcr = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOverlay.getState().end();
    useOverlay.getState().start(capture);
    useOverlay.getState().commit({ x: 100, y: 100, width: 240, height: 160 });
  });

  afterEach(() => {
    cleanup();
  });

  function renderToolbar() {
    return render(
      <Toolbar
        selection={{ x: 100, y: 100, width: 240, height: 160 }}
        monitorRect={{ x: 0, y: 0, width: 800, height: 600 }}
        onCopy={onCopy}
        onSave={onSave}
        onPin={onPin}
        onClose={onClose}
        onScroll={onScroll}
        onOcr={onOcr}
      />,
    );
  }

  it("renders screenshot actions in a vertical toolbar with a top drag handle", () => {
    const { container } = renderToolbar();

    const copy = screen.getByRole("button", { name: "Copy" });
    const save = screen.getByRole("button", { name: "Save As" });
    const pin = screen.getByRole("button", { name: "Pin" });
    const close = screen.getByRole("button", { name: "Close" });
    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement | null;
    const handle = container.querySelector("[data-screenshot-toolbar-drag-handle]") as HTMLElement | null;

    expect(toolbar).not.toBeNull();
    expect(handle).not.toBeNull();
    expect(toolbar?.firstElementChild).toBe(handle);
    expect(toolbar?.style.flexDirection).toBe("column");
    expect(toolbar?.style.height).toBe("");
    expect(copy.textContent).toBe("");
    expect(save.textContent).toBe("");
    expect(pin.textContent).toBe("");
    expect(close.textContent).toBe("");
    expect(screen.queryByText("Copy")).toBeNull();

    fireEvent.mouseEnter(copy);

    expect(screen.getByRole("tooltip").textContent).toBe("Copy");
  });

  it("groups pin and scrolling screenshot above the close action", () => {
    const { container } = renderToolbar();
    const pinScrollGroup = container.querySelector('[data-screenshot-toolbar-group="pin-scroll"]');
    const closeGroup = container.querySelector('[data-screenshot-toolbar-group="close"]');

    expect(pinScrollGroup).not.toBeNull();
    expect(closeGroup).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Pin"]')).not.toBeNull();
    expect(pinScrollGroup?.querySelector('[aria-label="Scrolling screenshot"]')).not.toBeNull();
    expect(closeGroup?.querySelector('[aria-label="Close"]')).not.toBeNull();

    const groups = Array.from(container.querySelectorAll("[data-screenshot-toolbar-group]"));
    expect(groups.indexOf(pinScrollGroup as Element)).toBeLessThan(groups.indexOf(closeGroup as Element));
  });

  it("uses a vertical chevrons ellipsis icon for scrolling screenshot", () => {
    renderToolbar();

    const icon = screen
      .getByRole("button", { name: "Scrolling screenshot" })
      .querySelector("svg");
    const paths = Array.from(icon?.querySelectorAll("path") ?? []).map((path) =>
      path.getAttribute("d"),
    );

    expect(icon?.getAttribute("data-scroll-screenshot-icon")).toBe("vertical");
    expect(paths).toEqual(
      expect.arrayContaining([
        "M12 8h.01",
        "M12 12h.01",
        "M12 16h.01",
        "m7 7 5-5 5 5",
        "m7 17 5 5 5-5",
      ]),
    );
  });

  it("defaults to the right side of the selection", () => {
    const { container } = renderToolbar();
    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement;

    expect(toolbar.style.left).toBe("344px");
    expect(toolbar.style.top).toBe("100px");
  });

  it("keeps the toolbar inside monitor bounds while dragging", () => {
    const { container } = renderToolbar();
    const handle = container.querySelector("[data-screenshot-toolbar-drag-handle]") as HTMLElement;

    fireEvent.mouseDown(handle, { clientX: 350, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 900, clientY: 800 });
    fireEvent.mouseUp(document);

    const toolbar = container.querySelector("[data-screenshot-toolbar]") as HTMLElement;
    expect(toolbar.style.left).toBe("760px");
    expect(toolbar.style.top).toBe("377px");
  });

  it("routes output actions through the provided callbacks", async () => {
    renderToolbar();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save As" }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(onCopy).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
