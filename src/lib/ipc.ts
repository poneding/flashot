import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  CaptureStartPayload,
  OcrDownloadProgress,
  OcrInstallStatus,
  OcrResult,
  QuickShotFlashPayload,
  Rect,
  ScrollEndReason,
  ScrollProgress,
  ScrollResult,
  Settings,
} from "@/lib/types";

export type SelectionClaimPayload = {
  monitorId: number;
};

const COLOR_FORMAT_TOGGLE_REQUESTED = "capture:color-format-toggle-requested";
const COLOR_COPY_REQUESTED = "capture:color-copy-requested";

export async function cropAndCopy(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<void> {
  await invoke("crop_and_copy", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
}
export async function cropAndSave(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<string | null> {
  return await invoke<string | null>("crop_and_save", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
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
export async function beginTextInputSession(): Promise<void> {
  await invoke("begin_text_input_session");
}
export async function endTextInputSession(): Promise<void> {
  await invoke("end_text_input_session");
}
export async function listSystemFonts(): Promise<string[]> {
  return await invoke<string[]>("list_system_fonts");
}
export async function pinImage(
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
): Promise<string> {
  return await invoke<string>("pin_image", {
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
  });
}
export async function closePin(pinId: string): Promise<void> {
  await invoke("close_pin", { pinId });
}
export async function setPinScale(pinId: string, scale: number): Promise<void> {
  await invoke("set_pin_scale", { pinId, scale });
}

export function onCaptureStart(cb: (p: CaptureStartPayload) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<CaptureStartPayload>(
    "capture:start",
    (e) => cb(e.payload),
  );
}
export function onQuickShotFlash(cb: (p: QuickShotFlashPayload) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<QuickShotFlashPayload>(
    "quick-shot:flash",
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

export async function requestColorFormatToggle(): Promise<void> {
  await emit(COLOR_FORMAT_TOGGLE_REQUESTED, {});
}

export function onColorFormatToggleRequested(cb: () => void): Promise<UnlistenFn> {
  return listen(COLOR_FORMAT_TOGGLE_REQUESTED, () => cb());
}

export async function requestColorCopy(): Promise<void> {
  await emit(COLOR_COPY_REQUESTED, {});
}

export function onColorCopyRequested(cb: () => void): Promise<UnlistenFn> {
  return listen(COLOR_COPY_REQUESTED, () => cb());
}

export async function startScrollSession(monitorId: number, rect: Rect): Promise<void> {
  await invoke("start_scroll_session", { monitorId, rect });
}

export async function stopScrollSession(commit: boolean): Promise<ScrollResult | null> {
  return await invoke<ScrollResult | null>("stop_scroll_session", { commit });
}

export async function scrollCopy(): Promise<void> {
  await invoke("scroll_copy");
}

export async function scrollSave(): Promise<string | null> {
  return await invoke<string | null>("scroll_save");
}

// Note: scroll_copy / scroll_save / stop_scroll_session do NOT take a monitorId
// argument. The backend reads it from the active ScrollState and uses it to
// tear down the chrome window. This keeps the TS surface minimal.

type ScrollProgressEvent = {
  frames: number;
  height: number;
  preview_png_base64: string;
  last_score: number;
};

export function onScrollProgress(cb: (p: ScrollProgress) => void): Promise<UnlistenFn> {
  return listen<ScrollProgressEvent>("scroll:progress", (e) => {
    cb({
      frames: e.payload.frames,
      height: e.payload.height,
      previewDataUrl: `data:image/png;base64,${e.payload.preview_png_base64}`,
      lastScore: e.payload.last_score,
    });
  });
}

export function onScrollEndDetected(cb: (reason: ScrollEndReason) => void): Promise<UnlistenFn> {
  return listen<{ reason: ScrollEndReason }>("scroll:end-detected", (e) => cb(e.payload.reason));
}

export function onScrollMatchFailed(cb: (info: { consecutiveFailures: number; score: number }) => void): Promise<UnlistenFn> {
  return listen<{ consecutive_failures: number; score: number }>("scroll:match-failed", (e) =>
    cb({ consecutiveFailures: e.payload.consecutive_failures, score: e.payload.score }),
  );
}

export const ocr = {
  status: () => invoke<OcrInstallStatus>("ocr_status"),
  install: () => invoke<void>("ocr_install"),
  recognize: (monitorId: number, rect: Rect) =>
    invoke<OcrResult>("ocr_recognize", { monitorId, rect }),
  saveText: (text: string) => invoke<void>("ocr_save_text", { text }),
  onDownloadProgress: (cb: (p: OcrDownloadProgress) => void): Promise<UnlistenFn> =>
    listen<OcrDownloadProgress>("ocr:download-progress", (e) => cb(e.payload)),
};

export function onOcrResultCached(cb: (result: OcrResult) => void): Promise<UnlistenFn> {
  return listen<OcrResult>("ocr:result-cached", (e) => cb(e.payload));
}
