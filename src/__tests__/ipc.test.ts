/** @vitest-environment jsdom */
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseDefaultSaveDir,
  copyPin,
  cropAndCopy,
  cropAndSave,
  pinImage,
  savePin,
  updatePinAnnotation,
} from "@/lib/ipc";
import type { ImageAdjustments, Rect } from "@/lib/types";

function captureInvocations() {
  const invocations: Array<{ cmd: string; payload?: unknown }> = [];

  mockIPC((cmd, payload) => {
    invocations.push({ cmd, payload });

    if (cmd === "crop_and_save") {
      return null;
    }

    if (cmd === "pin_image") {
      return "pin-1";
    }

    return undefined;
  });

  return invocations;
}

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
        cornerRadius: 0,
        adjustments: null,
      },
    });
  });

  it("serializes image adjustments for copy, save, and pin outputs", async () => {
    const rect: Rect = { x: 0, y: 0, width: 10, height: 10 };
    const adjustments: ImageAdjustments = {
      grayscale: true,
      brightness: 12,
      contrast: -8,
      saturation: 25,
    };
    const invocations = captureInvocations();

    await cropAndCopy(1, rect, undefined, 0, adjustments);
    await cropAndSave(1, rect, undefined, 0, adjustments);
    await pinImage(1, rect, undefined, 0, adjustments);

    expect(invocations).toEqual([
      {
        cmd: "crop_and_copy",
        payload: expect.objectContaining({ adjustments }),
      },
      {
        cmd: "crop_and_save",
        payload: expect.objectContaining({ adjustments }),
      },
      {
        cmd: "pin_image",
        payload: expect.objectContaining({ adjustments }),
      },
    ]);
  });

  it("serializes pin annotation updates, save requests, and copy requests", async () => {
    const annotationPng = new Uint8Array([7, 8, 9]).buffer;
    const invocations = captureInvocations();

    await updatePinAnnotation("pin-1", annotationPng);
    await updatePinAnnotation("pin-1");
    await savePin("pin-1", annotationPng);
    await savePin("pin-1");
    await copyPin("pin-1", annotationPng);
    await copyPin("pin-1");

    expect(invocations).toEqual([
      {
        cmd: "update_pin_annotation",
        payload: { pinId: "pin-1", annotationPng: [7, 8, 9] },
      },
      {
        cmd: "update_pin_annotation",
        payload: { pinId: "pin-1", annotationPng: null },
      },
      {
        cmd: "save_pin",
        payload: { pinId: "pin-1", annotationPng: [7, 8, 9], adjustments: null },
      },
      {
        cmd: "save_pin",
        payload: { pinId: "pin-1", annotationPng: null, adjustments: null },
      },
      {
        cmd: "copy_pin",
        payload: { pinId: "pin-1", annotationPng: [7, 8, 9], adjustments: null },
      },
      {
        cmd: "copy_pin",
        payload: { pinId: "pin-1", annotationPng: null, adjustments: null },
      },
    ]);
  });

  it("serializes image adjustments for pin save and copy outputs", async () => {
    const adjustments: ImageAdjustments = {
      grayscale: true,
      brightness: 18,
      contrast: -12,
      saturation: 30,
    };
    const invocations = captureInvocations();

    await savePin("pin-1", undefined, adjustments);
    await copyPin("pin-1", undefined, adjustments);

    expect(invocations).toEqual([
      {
        cmd: "save_pin",
        payload: { pinId: "pin-1", annotationPng: null, adjustments },
      },
      {
        cmd: "copy_pin",
        payload: { pinId: "pin-1", annotationPng: null, adjustments },
      },
    ]);
  });

  it("passes the current default save location to the directory picker", async () => {
    const invocations = captureInvocations();

    await chooseDefaultSaveDir("/Users/dp/Pictures/Flashot");

    expect(invocations[invocations.length - 1]).toEqual({
      cmd: "choose_default_save_dir",
      payload: { currentDir: "/Users/dp/Pictures/Flashot" },
    });
  });

  describe("cropAndCopy/Save/pinImage forward cornerRadius", () => {
    it("forwards cornerRadius to crop_and_copy", async () => {
      const invocations = captureInvocations();

      await cropAndCopy(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 12);

      expect(invocations[invocations.length - 1]).toEqual({
        cmd: "crop_and_copy",
        payload: expect.objectContaining({ cornerRadius: 12 }),
      });
    });

    it("forwards cornerRadius to crop_and_save", async () => {
      const invocations = captureInvocations();

      await cropAndSave(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 8);

      expect(invocations[invocations.length - 1]).toEqual({
        cmd: "crop_and_save",
        payload: expect.objectContaining({ cornerRadius: 8 }),
      });
    });

    it("forwards cornerRadius to pin_image", async () => {
      const invocations = captureInvocations();

      await pinImage(1, { x: 0, y: 0, width: 10, height: 10 }, undefined, 4);

      expect(invocations[invocations.length - 1]).toEqual({
        cmd: "pin_image",
        payload: expect.objectContaining({ cornerRadius: 4 }),
      });
    });
  });
});
