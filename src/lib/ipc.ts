import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CaptureStartPayload, Rect, Settings } from "@/lib/types";

export type SelectionClaimPayload = {
  monitorId: number;
};

export async function cropAndCopy(monitorId: number, rect: Rect): Promise<void> {
  await invoke("crop_and_copy", { monitorId, rect });
}
export async function cropAndSave(monitorId: number, rect: Rect): Promise<string | null> {
  return await invoke<string | null>("crop_and_save", { monitorId, rect });
}
export async function cancelCapture(): Promise<void> {
  await invoke("cancel_capture");
}
export async function getSettings(): Promise<Settings> {
  return await invoke<Settings>("get_settings");
}
export async function setSettings(s: Settings): Promise<void> {
  await invoke("set_settings", { settings: s });
}
export async function openSettingsWindow(): Promise<void> {
  await invoke("open_settings_window");
}

export function onCaptureStart(cb: (p: CaptureStartPayload) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<CaptureStartPayload>(
    "capture:start",
    (e) => cb(e.payload),
  );
}
export function onCaptureEnd(cb: () => void): Promise<UnlistenFn> {
  return listen("capture:end", () => cb());
}
export async function claimSelection(monitorId: number): Promise<void> {
  await emit("capture:selection-claimed", { monitorId } satisfies SelectionClaimPayload);
}
export function onSelectionClaimed(cb: (p: SelectionClaimPayload) => void): Promise<UnlistenFn> {
  return listen<SelectionClaimPayload>("capture:selection-claimed", (e) => cb(e.payload));
}
export async function releaseSelection(monitorId: number): Promise<void> {
  await emit("capture:selection-released", { monitorId } satisfies SelectionClaimPayload);
}
export function onSelectionReleased(cb: (p: SelectionClaimPayload) => void): Promise<UnlistenFn> {
  return listen<SelectionClaimPayload>("capture:selection-released", (e) => cb(e.payload));
}
