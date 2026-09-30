import type {
  CaptureStartPayload,
  ImageAdjustments,
  QuickShotFlashPayload,
  Rect,
  ScrollProgress,
  ScrollResult,
  Settings,
} from "@/lib/types";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { PIN_ACTION_EVENT, PIN_TOOLS_PLACEMENT_EVENT, PIN_TOOLS_STATE_EVENT, type PinAction, type PinResizeDirection, type PinToolKind, type PinToolLayout, type PinToolPlacement, type PinToolsEnvelope, type PinToolsSnapshot } from "@/pin/types";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export type SelectionClaimPayload = {
  sessionId: string;
  monitorId: number;
};

const COLOR_FORMAT_TOGGLE_REQUESTED = "capture:color-format-toggle-requested";
const COLOR_COPY_REQUESTED = "capture:color-copy-requested";
const SCROLL_PROGRESS = "scroll:progress";
const SCROLL_MAX_HEIGHT = "scroll:max-height";

export async function cropAndCopy(
  sessionId: string,
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
  adjustments?: ImageAdjustments,
): Promise<void> {
  await invoke("crop_and_copy", {
    sessionId,
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
    adjustments: adjustments ?? null,
  });
}
export async function cropAndSave(
  sessionId: string,
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
  adjustments?: ImageAdjustments,
): Promise<string | null> {
  return await invoke<string | null>("crop_and_save", {
    sessionId,
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
    adjustments: adjustments ?? null,
  });
}
export async function cancelCapture(sessionId: string): Promise<void> {
  await invoke("cancel_capture", { sessionId });
}
export async function getSettings(): Promise<Settings> {
  return await invoke<Settings>("get_settings");
}
export async function setSettings(s: Partial<Settings>): Promise<Settings> {
  return await invoke<Settings>("set_settings", { settings: s });
}
export async function chooseDefaultSaveDir(currentDir?: string): Promise<string | null> {
  return await invoke<string | null>("choose_default_save_dir", {
    currentDir: currentDir ?? null,
  });
}
export async function onSettingsChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("settings:changed", cb);
}
export async function openSettingsWindow(): Promise<void> {
  await invoke("open_settings_window");
}
export async function beginTextInputSession(inputId: string, sessionId: string | null): Promise<void> {
  await invoke("begin_text_input_session", { inputId, sessionId });
}
export async function endTextInputSession(inputId: string, sessionId: string | null): Promise<void> {
  await invoke("end_text_input_session", { inputId, sessionId });
}
export async function pushCaptureCursorMacos(): Promise<void> {
  await invoke("push_capture_cursor_macos");
}
export async function setCaptureCursorMacos(cursor: string): Promise<void> {
  await invoke("set_capture_cursor_macos", { cursor });
}
export async function captureOverlayReady(revision: string, monitorId: number): Promise<void> {
  await invoke("capture_overlay_ready", { revision, monitorId });
}
export async function listSystemFonts(): Promise<string[]> {
  return await invoke<string[]>("list_system_fonts");
}
export async function pinImage(
  sessionId: string,
  monitorId: number,
  rect: Rect,
  annotationPng?: ArrayBuffer,
  cornerRadius: number = 0,
  adjustments?: ImageAdjustments,
): Promise<string> {
  return await invoke<string>("pin_image", {
    sessionId,
    monitorId,
    rect,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    cornerRadius,
    adjustments: adjustments ?? null,
  });
}
export async function closePin(pinId: string): Promise<void> {
  await invoke("close_pin", { pinId });
}
export async function setPinScale(pinId: string, scale: number): Promise<void> {
  await invoke("set_pin_scale", { pinId, scale });
}

export async function syncPinTools(pinId: string, state: PinToolsSnapshot): Promise<void> {
  await invoke("sync_pin_tools", { pinId, state });
}

export async function getPinToolsState(pinId: string): Promise<PinToolsEnvelope | null> {
  return await invoke("get_pin_tools_state", { pinId });
}

export async function resizePinToolWindow(pinId: string, kind: PinToolKind, layout: PinToolLayout): Promise<void> {
  await invoke("resize_pin_tool_window", { pinId, kind, layout });
}

export async function startPinDrag(pinId: string): Promise<void> {
  await invoke("start_pin_drag", { pinId });
}

export async function pinInteractionContainsCursor(pinId: string): Promise<boolean> {
  return await invoke("pin_interaction_contains_cursor", { pinId });
}

export function onPinAction(cb: (action: PinAction) => void): Promise<UnlistenFn> {
  return listen<PinAction>(PIN_ACTION_EVENT, (event) => cb(event.payload));
}

export async function sendPinAction(pinId: string, action: PinAction): Promise<void> {
  await emitTo(`pin-${pinId}`, PIN_ACTION_EVENT, action);
}

export function onPinToolsState(cb: (state: PinToolsEnvelope) => void): Promise<UnlistenFn> {
  return listen<PinToolsEnvelope>(PIN_TOOLS_STATE_EVENT, (event) => cb(event.payload));
}

export function onPinToolsPlacement(cb: (placement: PinToolPlacement) => void): Promise<UnlistenFn> {
  return listen<PinToolPlacement>(PIN_TOOLS_PLACEMENT_EVENT, (event) => cb(event.payload));
}

export async function beginPinResize(pinId: string, direction: PinResizeDirection): Promise<string> {
  return await invoke("begin_pin_resize", { pinId, direction });
}

export async function resizePin(pinId: string, token: string, deltaX: number, deltaY: number): Promise<number> {
  return await invoke("resize_pin", { pinId, token, deltaX, deltaY });
}

export async function endPinResize(pinId: string, token: string): Promise<void> {
  await invoke("end_pin_resize", { pinId, token });
}
export async function updatePinAnnotation(
  pinId: string,
  annotationPng?: ArrayBuffer,
): Promise<void> {
  await invoke("update_pin_annotation", {
    pinId,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
  });
}
export async function savePin(
  pinId: string,
  annotationPng?: ArrayBuffer,
  adjustments?: ImageAdjustments,
): Promise<string | null> {
  return await invoke<string | null>("save_pin", {
    pinId,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    adjustments: adjustments ?? null,
  });
}
export async function copyPin(
  pinId: string,
  annotationPng?: ArrayBuffer,
  adjustments?: ImageAdjustments,
): Promise<void> {
  await invoke("copy_pin", {
    pinId,
    annotationPng: annotationPng ? Array.from(new Uint8Array(annotationPng)) : null,
    adjustments: adjustments ?? null,
  });
}

export function onCaptureStart(cb: (p: CaptureStartPayload) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<CaptureStartPayload>(
    "capture:start",
    (e) => cb(e.payload),
  );
}
export function onCaptureRevealed(cb: (revision: string) => void): Promise<UnlistenFn> {
  return listen<string>("capture:revealed", (e) => cb(e.payload));
}
export function onQuickShotFlash(cb: (p: QuickShotFlashPayload) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<QuickShotFlashPayload>(
    "quick-shot:flash",
    (e) => cb(e.payload),
  );
}
export function onCaptureEnd(cb: (sessionId: string) => void): Promise<UnlistenFn> {
  return listen<string>("capture:end", (e) => cb(e.payload));
}
export async function claimSelection(sessionId: string, monitorId: number): Promise<void> {
  await emit("capture:selection-claimed", { sessionId, monitorId } satisfies SelectionClaimPayload);
}
export function onSelectionClaimed(cb: (p: SelectionClaimPayload) => void): Promise<UnlistenFn> {
  return listen<SelectionClaimPayload>("capture:selection-claimed", (e) => cb(e.payload));
}
export async function releaseSelection(sessionId: string, monitorId: number): Promise<void> {
  await emit("capture:selection-released", { sessionId, monitorId } satisfies SelectionClaimPayload);
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

export async function startScrollSession(sessionId: string, monitorId: number, rect: Rect): Promise<void> {
  await invoke("start_scroll_session", { sessionId, monitorId, rect });
}

export async function stopScrollSession(sessionId: string, commit: boolean): Promise<ScrollResult | null> {
  return await invoke<ScrollResult | null>("stop_scroll_session", { sessionId, commit });
}

export async function scrollPin(sessionId: string): Promise<string> {
  return await invoke<string>("scroll_pin", { sessionId });
}

export async function scrollCopy(sessionId: string): Promise<void> {
  await invoke("scroll_copy", { sessionId });
}

export async function scrollSave(sessionId: string): Promise<string | null> {
  return await invoke<string | null>("scroll_save", { sessionId });
}

// Note: scroll_pin / scroll_copy / scroll_save / stop_scroll_session do NOT take a monitorId
// argument. The backend reads it from the active ScrollState and uses it to
// tear down the chrome window. This keeps the TS surface minimal.

type ScrollProgressEvent = {
  frames: number;
  height: number;
  preview_png_base64: string;
  last_score: number;
};

// Both scroll events are emitted by the backend to the chrome webview window
// only (not broadcast), so they must be listened to through the current
// webview window, like capture:start.
export function onScrollProgress(cb: (p: ScrollProgress) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<ScrollProgressEvent>(SCROLL_PROGRESS, (e) => {
    cb({
      frames: e.payload.frames,
      height: e.payload.height,
      previewDataUrl: `data:image/png;base64,${e.payload.preview_png_base64}`,
      lastScore: e.payload.last_score,
    });
  });
}

/** Fired once when the stitcher hits its maximum canvas height; the chrome
 * window reacts by finishing the capture as if the user clicked finish. */
export function onScrollMaxHeight(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen(SCROLL_MAX_HEIGHT, () => cb());
}
