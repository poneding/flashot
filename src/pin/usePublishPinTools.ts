import { useEffect, useRef } from "react";
import { useAnnotation } from "@/annotation/store";
import { syncPinTools } from "@/lib/ipc";
import type { PinToolsSnapshot } from "@/pin/types";

/** Only the image window owns the document and undo stack. Palettes receive a small view. */
export function usePublishPinTools(pinId: string | null, view: Omit<PinToolsSnapshot, "annotation">) {
  const viewRef = useRef(view);
  viewRef.current = view;
  const publishRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!pinId) return;
    let stopped = false;
    let frame = 0;
    let sending = false;
    let signature = "";
    let pending: PinToolsSnapshot | null = null;
    const send = async () => {
      if (sending) return;
      sending = true;
      try {
        while (pending && !stopped) {
          const state = pending;
          pending = null;
          await syncPinTools(pinId, state);
        }
      } catch (error) {
        if (!stopped) console.warn("Could not update pin controls", error);
      } finally { sending = false; }
    };
    const publish = () => {
      frame = 0;
      if (stopped) return;
      const state = useAnnotation.getState();
      const selected = state.objects.find(object => object.id === state.selectedObjectId);
      const next: PinToolsSnapshot = {
        ...viewRef.current,
        annotation: {
          activeTool: state.activeTool, activeStyle: state.activeStyle,
          selectedObjectId: state.selectedObjectId,
          // The property panel needs style and endpoints, not a potentially large pen path.
          objects: selected ? [{ ...selected, points: undefined }] : [],
          currentMarkerNumber: state.currentMarkerNumber, canUndo: state.canUndo, canRedo: state.canRedo,
        },
      };
      const serialized = JSON.stringify(next);
      if (serialized === signature) return;
      signature = serialized;
      pending = next;
      void send();
    };
    const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(publish); };
    publishRef.current = schedule;
    const unsubscribe = useAnnotation.subscribe(schedule);
    schedule();
    return () => {
      stopped = true;
      pending = null;
      cancelAnimationFrame(frame);
      unsubscribe();
      publishRef.current = () => {};
    };
  }, [pinId]);

  useEffect(() => publishRef.current(), [view.visible, view.editing, view.scale, view.copyConfirmed, view.locale, view.imageAdjustments]);
}
