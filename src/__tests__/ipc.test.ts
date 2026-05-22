/** @vitest-environment jsdom */
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { pinImage } from "@/lib/ipc";
import type { Rect } from "@/lib/types";

describe("ipc wrappers", () => {
  afterEach(() => {
    clearMocks();
  });

  it("serializes annotation PNG data for pinned screenshots", async () => {
    const rect: Rect = { x: 10, y: 20, width: 30, height: 40 };
    const annotationPng = new Uint8Array([1, 2, 255]).buffer;
    let invocation: { cmd: string; payload?: unknown } | null = null;

    mockIPC((cmd, payload) => {
      invocation = { cmd, payload };
      return "pin-1";
    });

    await expect(pinImage(7, rect, annotationPng)).resolves.toBe("pin-1");
    expect(invocation).toEqual({
      cmd: "pin_image",
      payload: {
        monitorId: 7,
        rect,
        annotationPng: [1, 2, 255],
      },
    });
  });
});
