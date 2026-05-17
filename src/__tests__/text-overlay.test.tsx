import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextOverlay } from "@/annotation/TextOverlay";
import {
  HANDWRITING_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from "@/annotation/fonts";
import { useAnnotation } from "@/annotation/store";
import type { Rect } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  beginTextInputSession: vi.fn().mockResolvedValue(undefined),
  endTextInputSession: vi.fn().mockResolvedValue(undefined),
}));

const selection: Rect = { x: 50, y: 40, width: 320, height: 180 };

describe("TextOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAnnotation.getState().reset();
  });

  it("opens the editor above the clicked I-beam hotspot", () => {
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const editor = screen.getByRole("textbox");
    expect(editor.style.left).toBe("120px");
    expect(editor.style.top).toBe("78px");
  });

  it("starts empty without a hidden seed character", () => {
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
  });

  it("keeps Enter from confirming text while an IME composition is active", () => {
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "ni" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms the composed Chinese text without leftover latin input", () => {
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "ni" } });
    fireEvent.compositionEnd(editor, { data: "你" });
    fireEvent.change(editor, { target: { value: "你" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].text).toBe("你");
  });

  it("uses the handwriting font stack and extra line height while editing text", () => {
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    expect(editor.style.fontFamily).toBe(HANDWRITING_FONT_FAMILY);
    expect(editor.style.lineHeight).toBe(String(TEXT_LINE_HEIGHT));
    expect(parseFloat(editor.style.height)).toBeGreaterThan(24);
  });

  it("normalizes legacy Excalifont text styles when committing", () => {
    useAnnotation.getState().setActiveStyle({ fontFamily: "Excalifont" });
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.change(editor, { target: { value: "你好" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onConfirm.mock.calls[0][0].style.fontFamily).toBe("handwriting");
  });

  it("commits new text at the visual editor position instead of the click hotspot", () => {
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.change(editor, { target: { value: "hello" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onConfirm.mock.calls[0][0].start).toEqual({ x: 70, y: 38 });
  });

  it("keeps an existing text object anchored at its stored position while editing", () => {
    const onConfirm = vi.fn();
    render(
      <TextOverlay
        position={{ x: 150, y: 130 }}
        selection={selection}
        editingObject={{
          id: "text-1",
          type: "text",
          start: { x: 20, y: 30 },
          text: "old",
          style: { color: "#ff0000", strokeWidth: 4, fontSize: 24 },
          transform: { x: 12, y: 8, scaleX: 1, scaleY: 1, rotation: 0 },
        }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox");

    expect(editor.style.left).toBe("82px");
    expect(editor.style.top).toBe("78px");

    fireEvent.change(editor, { target: { value: "new" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      id: "text-1",
      start: { x: 20, y: 30 },
      text: "new",
      transform: { x: 12, y: 8, scaleX: 1, scaleY: 1, rotation: 0 },
    });
  });

  it("starts and restores the native text input session around editing", async () => {
    const ipc = await import("@/lib/ipc") as unknown as {
      beginTextInputSession: ReturnType<typeof vi.fn>;
      endTextInputSession: ReturnType<typeof vi.fn>;
    };

    const { unmount } = render(
      <TextOverlay
        position={{ x: 120, y: 90 }}
        selection={selection}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(ipc.beginTextInputSession).toHaveBeenCalledTimes(1);
    unmount();
    expect(ipc.endTextInputSession).toHaveBeenCalledTimes(1);
  });
});
