import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationControlsContext, type AnnotationControls } from "@/annotation/controls";
import { FloatingWindowContext } from "@/annotation/FloatingWindowContext";
import { getPinToolsState, onPinToolsPlacement, onPinToolsState, sendPinAction, startPinDrag } from "@/lib/ipc";
import { PinControls } from "@/pin/PinControls";
import { clampPinScale, isPinTextInput, pinScaleOptions, PIN_SCALE_STEP } from "@/pin/scale";
import { type PinAction, type PinToolKind, type PinToolPlacement, type PinToolsEnvelope } from "@/pin/types";
import { usePinToolBounds } from "@/pin/usePinToolBounds";
import { usePinDrag } from "@/pin/usePinDrag";
import { useStoredAccentColor } from "@/settings/useStoredAccentColor";

const AnnotationToolbar = lazy(() => import("@/annotation/Toolbar").then(module => ({ default: module.Toolbar })));

function route(): { pinId: string; kind: PinToolKind } | null {
  const match = window.location.hash.match(/^#\/pin-tools\/([^/?#]+)\/(controls|editor)(?:[?#]|$)/);
  return match ? { pinId: match[1], kind: match[2] as PinToolKind } : null;
}

export function PinToolsRoute({ pinId: explicitId, kind: explicitKind }: { pinId?: string; kind?: PinToolKind } = {}) {
  useStoredAccentColor();
  const [initial] = useState(route);
  const pinId = explicitId ?? initial?.pinId ?? "";
  const kind = explicitKind ?? initial?.kind ?? "controls";
  const [envelope, setEnvelope] = useState<PinToolsEnvelope | null>(null);
  const revision = useRef(-1);
  const [side, setSide] = useState<PinToolPlacement["side"]>(kind === "controls" ? "right" : "bottom");
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [adjustmentsPanelOpen, setAdjustmentsPanelOpen] = useState(false);
  const menusRef = useRef({ scaleMenuOpen, adjustmentsPanelOpen });
  menusRef.current = { scaleMenuOpen, adjustmentsPanelOpen };
  const options = useMemo(pinScaleOptions, []);
  const onPlacement = useCallback((placement: PinToolPlacement) => setSide(placement.side), []);
  const { setRoot, offset } = usePinToolBounds(pinId, kind);
  const drag = usePinDrag(() => startPinDrag(pinId));
  const state = envelope?.state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const send = useCallback((action: PinAction) => { void sendPinAction(pinId, action).catch(() => {}); }, [pinId]);

  useEffect(() => {
    document.body.classList.add("pin-tools");
    return () => document.body.classList.remove("pin-tools");
  }, []);

  useEffect(() => {
    if (!pinId) return;
    let cancelled = false;
    const apply = (next: PinToolsEnvelope | null) => {
      if (cancelled || !next || next.pinId !== pinId || next.revision < revision.current) return;
      revision.current = next.revision;
      setEnvelope(next);
    };
    const stateListener = onPinToolsState(apply);
    const placementListener = onPinToolsPlacement(onPlacement);
    void stateListener.then(() => getPinToolsState(pinId)).then(apply).catch(() => {});
    return () => {
      cancelled = true;
      void stateListener.then(unlisten => unlisten()).catch(() => {});
      void placementListener.then(unlisten => unlisten()).catch(() => {});
    };
  }, [pinId, onPlacement]);

  useEffect(() => {
    setScaleMenuOpen(false);
    setAdjustmentsPanelOpen(false);
  }, [state?.editing, state?.visible]);

  useEffect(() => {
    if (!initial) return;
    const focus = () => send({ type: "focus", kind, visible: true });
    const blur = () => send({ type: "focus", kind, visible: false });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && (menusRef.current.scaleMenuOpen || menusRef.current.adjustmentsPanelOpen)) {
        event.preventDefault();
        setScaleMenuOpen(false);
        setAdjustmentsPanelOpen(false);
        return;
      }
      if (isPinTextInput(document.activeElement)) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let action: PinAction | undefined;
      if (event.key === "Escape") action = { type: stateRef.current?.editing ? "edit" : "close" };
      else if (!command && key === "e") action = { type: "edit" };
      else if (command && key === "c") action = { type: "copy" };
      else if (command && key === "s") action = { type: "save" };
      else if (command && key === "z") action = { type: event.shiftKey ? "redo" : "undo" };
      else if (command && ["+", "=", "-", "0"].includes(key)) {
        const scale = stateRef.current?.scale ?? 1;
        action = { type: "scale", scale: key === "0" ? 1 : clampPinScale(scale + (key === "-" ? -1 : 1) * PIN_SCALE_STEP) };
      }
      if (action) { event.preventDefault(); send(action); }
    };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", keydown);
      send({ type: "hover", kind, visible: false });
      send({ type: "focus", kind, visible: false });
    };
  }, [initial, kind, send]);

  const annotationControls = useMemo<AnnotationControls | null>(() => state ? ({
    ...state.annotation,
    setActiveTool: tool => send({ type: "tool", tool }),
    updateSelectedStyle: updates => send({ type: "style", updates, tool: state.annotation.activeTool, selectedObjectId: state.annotation.selectedObjectId }),
    resizeObject: (id, updates) => send({ type: "resize-object", id, updates }),
    setCurrentMarkerNumber: value => send({ type: "marker-number", value }),
    undo: () => send({ type: "undo" }),
    redo: () => send({ type: "redo" }),
  }) : null, [state, send]);

  if (!pinId || !state || !annotationControls || (kind === "controls" ? !state.visible && !state.editing : !state.editing)) return null;

  return (
    <FloatingWindowContext.Provider value={side}>
      <div data-pin-tool-window={kind} style={{ position: "fixed", inset: 0, cursor: "move" }}
        onMouseDown={event => {
          // Transparent native window pixels still receive mouse events. Let
          // empty palette space move the owner instead of becoming a dead zone.
          if (event.target instanceof HTMLElement && event.target.matches("[data-pin-tool-window], [data-pin-tool-origin], [data-pin-editor-surface]")) drag.handleMouseDown(event);
        }}
        onMouseEnter={() => send({ type: "hover", kind, visible: true })}
        onMouseLeave={() => send({ type: "hover", kind, visible: false })}
        onFocusCapture={() => send({ type: "focus", kind, visible: true })}>
        <div ref={setRoot} data-pin-tool-origin style={{ position: "absolute", ...offset, width: "max-content" }}>
          {kind === "controls" ? (
            <PinControls scale={state.scale} scaleOptions={options} scaleMenuOpen={scaleMenuOpen}
              adjustmentsPanelOpen={adjustmentsPanelOpen} controlsSide={side === "left" ? "left" : "right"} copyConfirmed={state.copyConfirmed}
              editing={state.editing} locale={state.locale}
              onToggleScaleMenu={() => { setAdjustmentsPanelOpen(false); setScaleMenuOpen(open => !open); }}
              onToggleAdjustmentsPanel={() => { setScaleMenuOpen(false); setAdjustmentsPanelOpen(open => !open); }}
              onScaleSelect={scale => { setScaleMenuOpen(false); send({ type: "scale", scale }); }}
              onEdit={() => send({ type: "edit" })} onClose={() => send({ type: "close" })}
              onSave={() => send({ type: "save" })} onCopy={() => send({ type: "copy" })}
              adjustmentsControls={{ adjustments: state.imageAdjustments,
                setImageAdjustments: updates => send({ type: "adjustments", updates }),
                resetImageAdjustments: () => send({ type: "reset-adjustments" }),
              }} />
          ) : (
            <AnnotationControlsContext.Provider value={annotationControls}>
              <Suspense fallback={null}>
                <AnnotationToolbar placement="floating" locale={state.locale} opaqueSurface
                  selection={{ x: 0, y: 0, width: 1, height: 1 }}
                  monitorRect={{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }} />
              </Suspense>
            </AnnotationControlsContext.Provider>
          )}
        </div>
      </div>
    </FloatingWindowContext.Provider>
  );
}
