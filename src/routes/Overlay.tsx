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
  onColorCopyRequested,
  onColorFormatToggleRequested,
  onCaptureEnd,
  onCaptureStart,
  onQuickShotFlash,
  onSelectionClaimed,
  onSelectionReleased,
  pinImage,
  releaseSelection,
  requestColorCopy,
  requestColorFormatToggle,
  startScrollSession,
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
import type { CursorIcon } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useRef, useState } from "react";

function focusCurrentOverlay() {
  getCurrentWebviewWindow()
    .setFocus()
    .catch(() => {
      /* best effort */
    });
}

function ensureCurrentOverlayFocus() {
  if (typeof document !== "undefined" && document.hasFocus()) return;
  focusCurrentOverlay();
}

function colorPickerShortcutsActive() {
  const { mode, colorPickerVisible } = useOverlay.getState();
  return mode === "hover" || (mode === "committed" && colorPickerVisible);
}

function nativeCursorIcon(cursor: string): CursorIcon {
  switch (cursor) {
    case "crosshair":
      return "crosshair";
    case "move":
      return "move";
    case "nwse-resize":
      return "nwseResize";
    case "nesw-resize":
      return "neswResize";
    case "ns-resize":
      return "nsResize";
    case "ew-resize":
      return "ewResize";
    default:
      return "default";
  }
}

function setNativeOverlayCursor(cursor: string) {
  getCurrentWebviewWindow()
    .setCursorIcon(nativeCursorIcon(cursor))
    .catch(() => {
      /* best effort; CSS cursor remains as fallback */
    });
}

export function OverlayRoute() {
  const start = useOverlay((s) => s.start);
  const end = useOverlay((s) => s.end);
  const startScroll = useOverlay((s) => s.startScroll);
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
    // Wrap `start` so overlays try to own keyboard focus as soon as
    // they appear. The cursor-owner polling below keeps the focused
    // overlay aligned with the monitor under the pointer.
    onCaptureStart((payload) => {
      start(payload);
      focusCurrentOverlay();
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

  useEffect(() => {
    let unsubColorFormat: undefined | (() => void);
    let unsubColorCopy: undefined | (() => void);
    let cancelled = false;

    const runForCursorOwner = (action: () => void) => {
      if (!colorPickerShortcutsActive()) return;
      currentCursorPointInWindow()
        .then((p) => {
          if (cancelled || !p || !colorPickerShortcutsActive()) return;
          useOverlay.getState().updateHoverAt(p);
          ensureCurrentOverlayFocus();
          action();
        })
        .catch(() => {
          /* Hover polling already reports cursor read failures. */
        });
    };

    onColorFormatToggleRequested(() => {
      runForCursorOwner(() => {
        useOverlay.getState().toggleColorFormat();
      });
    }).then((u) => (unsubColorFormat = u));

    onColorCopyRequested(() => {
      runForCursorOwner(() => {
        const { colorFormat: fmt, currentColor, setColorCopied } = useOverlay.getState();
        if (!currentColor) return;
        const colorText = formatColorText(currentColor, fmt);
        void writeText(colorText).then(() => {
          setColorCopied(true);
          window.setTimeout(() => setColorCopied(false), 1500);
        });
      });
    }).then((u) => (unsubColorCopy = u));

    return () => {
      cancelled = true;
      unsubColorFormat?.();
      unsubColorCopy?.();
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
      const captureSessionActive = currentMode !== "idle";

      // Color picker shortcuts are broadcast because macOS can leave
      // keyboard focus on a different monitor's overlay. The overlay
      // under the cursor decides whether the picker is active.
      if (e.key.toLowerCase() === "x" && captureSessionActive) {
        e.preventDefault();
        e.stopPropagation();
        void requestColorFormatToggle();
        return;
      }
      if (
        (e.key === "c" || e.key === "C") &&
        captureSessionActive &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        void requestColorCopy();
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
          if (p) {
            ensureCurrentOverlayFocus();
            state.updateHoverAt(p);
          } else {
            state.clearHover();
          }
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

  const handleScroll = async () => {
    if (monitorId == null || !selection) return;
    await startScrollSession(monitorId, selection);
    startScroll();
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
    // Multi-monitor capture has one overlay window per monitor. Keep
    // the key window aligned with the overlay currently under the
    // pointer so shortcuts and visual feedback update the same panel.
    ensureCurrentOverlayFocus();
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

  useEffect(() => {
    setNativeOverlayCursor(overlayCursor);
    return () => {
      setNativeOverlayCursor("default");
    };
  }, [overlayCursor]);

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
            onScroll={handleScroll}
            selectionTooSmall={selection.height < 100}
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
