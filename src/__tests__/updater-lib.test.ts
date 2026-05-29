/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import { checkForUpdate, downloadAndInstall } from "@/lib/updater";

describe("updater IPC wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("checks for updates through the beta-aware backend command", async () => {
    invokeMock.mockResolvedValue({
      version: "0.3.0-beta.1",
      body: "Notes",
      date: "2026-05-19",
    });

    await expect(checkForUpdate({ allowBeta: true })).resolves.toEqual({
      version: "0.3.0-beta.1",
      body: "Notes",
      date: "2026-05-19",
    });

    expect(invokeMock).toHaveBeenCalledWith("check_for_update", { allowBeta: true });
  });

  it("downloads and installs with progress from the selected update channel", async () => {
    const unlisten = vi.fn();
    let progressHandler: ((event: { payload: { downloaded: number; total: number | null } }) => void) | null = null;
    const onProgress = vi.fn();

    listenMock.mockImplementation(async (_eventName, handler) => {
      progressHandler = handler;
      return unlisten;
    });
    invokeMock.mockImplementation(async () => {
      progressHandler?.({ payload: { downloaded: 128, total: 256 } });
    });

    await downloadAndInstall(onProgress, { allowBeta: true });

    expect(listenMock).toHaveBeenCalledWith("updater:progress", expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith("download_and_install_update", { allowBeta: true });
    expect(onProgress).toHaveBeenCalledWith({ downloaded: 0, total: null });
    expect(onProgress).toHaveBeenCalledWith({ downloaded: 128, total: 256 });
    expect(unlisten).toHaveBeenCalled();
  });
});
