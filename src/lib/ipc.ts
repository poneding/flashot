import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CaptureStartPayload, Rect, Settings } from "@/lib/types";

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
  return listen<CaptureStartPayload>("capture:start", (e) => cb(e.payload));
}
export function onCaptureEnd(cb: () => void): Promise<UnlistenFn> {
  return listen("capture:end", () => cb());
}
