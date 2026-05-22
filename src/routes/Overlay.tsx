import { exportAnnotationLayer } from "@/annotation/export";
import { AnnotationStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import { Toolbar as AnnotationToolbar } from "@/annotation/Toolbar";
import { currentCursorPointInWindow } from "@/lib/cursor";
import { cursorForHandle, hitTestHandle, rectContainsPoint } from "@/lib/geometry";
import {
  cancelCapture,
  claimSelection,
  cropAndCopy,
  cropAndSave,
  onCaptureEnd,
  onCaptureStart,
  onQuickShotFlash,
  onSelectionClaimed,
  onSelectionReleased,
  pinImage,
  releaseSelection,
} from "@/lib/ipc";
import type { Rect } from "@/lib/types";
import { ColorPicker, formatColorText } from "@/overlay/ColorPicker";
import { DetectHighlight } from "@/overlay/DetectHighlight";
import { DimMask } from "@/overlay/DimMask";
import { FrozenLayer } from "@/overlay/FrozenLayer";
import { SelectionBox } from "@/overlay/SelectionBox";
import { Toolbar as ScreenshotToolbar } from "@/overlay/Toolbar";
import { useOverlay } from "@/overlay/state";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useRef, useState } from "react";

export function OverlayRoute() {
  const start = useOverlay((s) => s.start);
  const end = useOverlay((s) => s.end);
  const updateHoverAt = useOverlay((s) => s.updateHoverAt);
  const beginDrag = useOverlay((s) => s.beginDrag);
  const updateDrag = useOverlay((s) => s.updateDrag);
  const commitDrag = useOverlay((s) => s.commitDrag);
  const beginMove = useOverlay((s) => s.beginMove);
  const beginResize = useOverlay((s) => s.beginResize);
  const updateSelectionInteraction = useOverlay((s) => s.updateSelectionInteraction);
  const finishSelectionInteraction = useOverlay((s) => s.finishSelectionInteraction);
  const mode = useOverlay((s) => s.mode);
  const monitorId = useOverlay((s) => s.monitorId);
  const selection = useOverlay((s) => s.selection);
  const cursor = useOverlay((s) => s.cursor);
  const selectionInteraction = useOverlay((s) => s.selectionInteraction);
  const frameUrl = useOverlay((s) => s.frameUrl);
  const scaleFactor = useOverlay((s) => s.scaleFactor);
  const monitorRect = useOverlay((s) => s.monitorRect);
  const [flashRect, setFlashRect] = useState<Rect | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.body.classList.add("overlay");
    let unsubStart: undefined | (() => void);
    let unsubEnd: undefined | (() => void);
    let unsubFlash: undefined | (() => void);
    // Wrap `start` so we also pull keyboard focus into the overlay
    // window the moment it appears. On macOS, the Rust side
    // intentionally does not call `set_focus` for the overlay, so
    // without this the user's previously-active app keeps keyboard
    // focus and X/C end up in that app instead of the color picker.
    onCaptureStart((payload) => {
      start(payload);
      getCurrentWebviewWindow()
        .setFocus()
        .catch(() => {
          /* best effort — onMouseMove will retry */
        });
    }).then((u) => (unsubStart = u));
    onCaptureEnd(() => {
      useAnnotation.getState().reset();
      end();
    }).then((u) => (unsubEnd = u));
    onQuickShotFlash((p) => {
      setFlashRect(p.rect);
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        setFlashRect(null);
        flashTimerRef.current = null;
      }, 420);
    }).then((u) => (unsubFlash = u));
    return () => {
      document.body.classList.remove("overlay");
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
      unsubStart?.();
      unsubEnd?.();
      unsubFlash?.();
    };
  }, [start, end]);

  useEffect(() => {
    let unsubClaimed: undefined | (() => void);
    let unsubReleased: undefined | (() => void);
    onSelectionClaimed((p) => {
      useOverlay.getState().lockToPeer(p.monitorId);
    }).then((u) => (unsubClaimed = u));
    onSelectionReleased((p) => {
      useOverlay.getState().unlockFromPeer(p.monitorId);
    }).then((u) => (unsubReleased = u));

    return () => {
      unsubClaimed?.();
      unsubReleased?.();
    };
  }, []);

  // Keyboard: Esc cancels; Cmd/Ctrl+C copies when committed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept keys when editing text annotations
      const active = document.activeElement;
      if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) return;

      if (e.key === "Escape") { e.preventDefault(); cancelCapture(); return; }

      // Read mode from the store directly — NOT from the closure.
      // The closure's `mode` can be stale: capture:start updates the
      // store synchronously but React re-renders (and re-registers
      // this handler) asynchronously. If the user presses X/C
      // between the store update and the re-render, the closure still
      // holds "idle" and the condition would fail.
      const currentMode = useOverlay.getState().mode;
      const colorPickerShortcutsActive =
        currentMode === "hover" ||
        (currentMode === "committed" && useOverlay.getState().colorPickerVisible);

      // Color picker: X toggles format, C copies color. Active during
      // hover, or after selection when the picker is explicitly open.
      // Always stopPropagation so the keystroke can't leak to the
      // underlying app if the overlay window happens to lose focus
      // mid-session.
      if (e.key === "x" && colorPickerShortcutsActive) {
        e.preventDefault();
        e.stopPropagation();
        useOverlay.getState().toggleColorFormat();
        return;
      }
      if (
        (e.key === "c" || e.key === "C") &&
        colorPickerShortcutsActive &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        const { colorFormat: fmt, currentColor, setColorCopied } = useOverlay.getState();
        if (!currentColor) return;
        const colorText = formatColorText(currentColor, fmt);
        void writeText(colorText).then(() => {
          setColorCopied(true);
          window.setTimeout(() => setColorCopied(false), 1500);
        });
        return;
      }

      if (currentMode === "committed") {
        const { undo, redo, deleteObject, selectedObjectId } = useAnnotation.getState();

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey) {
          e.preventDefault();
          redo();
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectId) {
          e.preventDefault();
          deleteObject(selectedObjectId);
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
          e.preventDefault();
          handleCopy();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          handleSave();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selection, monitorId]);

  useEffect(() => {
    if (mode !== "hover" || !frameUrl) return;
    let cancelled = false;
    let warned = false;

    const refreshHoverFromCursor = () => {
      currentCursorPointInWindow()
        .then((p) => {
          if (cancelled) return;
          const state = useOverlay.getState();
          if (state.mode !== "hover") return;
          if (p) state.updateHoverAt(p);
          else state.setDefaultHoverTarget();
        })
        .catch((error) => {
          if (!warned) {
            warned = true;
            console.warn("Failed to read cursor position", error);
          }
        });
    };

    refreshHoverFromCursor();
    const interval = window.setInterval(refreshHoverFromCursor, 50);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [mode, frameUrl]);

  const handleCopy = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await cropAndCopy(monitorId, selection, annotationPng ?? undefined);
  };

  const handleSave = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await cropAndSave(monitorId, selection, annotationPng ?? undefined);
  };

  const handlePin = async () => {
    if (monitorId == null || !selection) return;
    const annotationPng = await exportAnnotationLayer(scaleFactor);
    await pinImage(monitorId, selection, annotationPng ?? undefined);
  };

  const handleClose = () => {
    cancelCapture();
  };

  const claimCurrentOverlay = (claimedMonitorId: number | null) => {
    if (claimedMonitorId == null) return;
    claimSelection(claimedMonitorId).catch((error) => {
      console.warn("Failed to claim capture selection", error);
    });
  };
  const releaseCurrentOverlay = (claimedMonitorId: number | null) => {
    if (claimedMonitorId == null) return;
    releaseSelection(claimedMonitorId).catch((error) => {
      console.warn("Failed to release capture selection", error);
    });
  };

  // Mouse handling
  const ensureOverlayFocus = () => {
    // On macOS the overlay window is intentionally not focused at
    // capture start (so we don't steal the menu bar from the user's
    // app). That means the user's previously-active app may still own
    // keyboard focus when our overlay first appears, and X/C would
    // be delivered there. Re-claim focus whenever we notice we don't
    // have it — running on every mousemove is cheap and self-healing
    // if a single setFocus() call doesn't take.
    if (typeof document !== "undefined" && document.hasFocus()) return;
    getCurrentWebviewWindow()
      .setFocus()
      .catch(() => {
        /* best effort */
      });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    ensureOverlayFocus();
    const p = { x: e.clientX, y: e.clientY };
    updateHoverAt(p);
    const state = useOverlay.getState();
    if (state.selectionInteraction) {
      updateSelectionInteraction(p);
      return;
    }
    if (state.mode === "dragging") { updateDrag(p); return; }
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) { cancelCapture(); return; }
    const p = { x: e.clientX, y: e.clientY };
    const state = useOverlay.getState();

    if (state.mode === "committed" && state.selection) {
      const handle = hitTestHandle(p, state.selection, 10);
      if (handle) {
        claimCurrentOverlay(state.monitorId);
        beginResize(handle, p);
        return;
      }
      if (rectContainsPoint(state.selection, p)) {
        claimCurrentOverlay(state.monitorId);
        beginMove(p);
        return;
      }
      // Selection is locked once committed — no re-selection
      return;
    }

    if (state.mode === "hover") {
      claimCurrentOverlay(state.monitorId);
      beginDrag(p);
    }
  };
  const onMouseUp = () => {
    const state = useOverlay.getState();
    if (state.selectionInteraction) {
      finishSelectionInteraction();
      return;
    }
    if (state.mode === "dragging") {
      const ownerMonitorId = state.monitorId;
      commitDrag();
      const next = useOverlay.getState();
      if (next.mode === "hover" && !next.selection) {
        releaseCurrentOverlay(ownerMonitorId);
      }
    }
  };
  const onContextMenu = (e: React.MouseEvent) => { e.preventDefault(); cancelCapture(); };

  const overlayCursor = (() => {
    if (mode === "hover" || mode === "dragging") return "crosshair";
    if (selectionInteraction?.kind === "resize") return cursorForHandle(selectionInteraction.handle);
    if (selectionInteraction?.kind === "move") return "move";
    if (mode === "committed" && selection && cursor) {
      const handle = hitTestHandle(cursor, selection, 10);
      if (handle) return cursorForHandle(handle);
    }
    return "default";
  })();

  if (mode === "idle") return flashRect ? <QuickShotFlash rect={flashRect} /> : null;

  return (
    <div
      className={mode === "hover" || mode === "dragging" ? "overlay-crosshair" : undefined}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={onContextMenu}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "transparent",
        cursor: overlayCursor,
      }}
    >
      <FrozenLayer />
      <DimMask />
      <DetectHighlight />
      <SelectionBox />
      <ColorPicker />
      {mode === "committed" && selection && monitorRect && monitorId != null && (
        <>
          <AnnotationStage selection={selection} scaleFactor={scaleFactor} interacting={!!selectionInteraction} />
          <AnnotationToolbar
            selection={selection}
            monitorRect={{ x: 0, y: 0, width: monitorRect.width, height: monitorRect.height }}
          />
          <ScreenshotToolbar
            selection={selection}
            monitorRect={{ x: 0, y: 0, width: monitorRect.width, height: monitorRect.height }}
            onCopy={handleCopy}
            onSave={handleSave}
            onPin={handlePin}
            onClose={handleClose}
          />
        </>
      )}
      {flashRect && <QuickShotFlash rect={flashRect} />}
    </div>
  );
}

export function QuickShotFlash({ rect }: { rect: Rect }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        className="quick-shot-flash"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }}
      />
    </div>
  );
}
