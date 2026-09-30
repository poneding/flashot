import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { beginPinResize, endPinResize, resizePin } from "@/lib/ipc";
import type { PinResizeDirection } from "@/pin/types";

const EDGES: Record<PinResizeDirection, CSSProperties> = {
  North: { top: 0, left: 10, right: 10, height: 5, cursor: "ns-resize" },
  South: { bottom: 0, left: 10, right: 10, height: 5, cursor: "ns-resize" },
  East: { right: 0, top: 10, bottom: 10, width: 5, cursor: "ew-resize" },
  West: { left: 0, top: 10, bottom: 10, width: 5, cursor: "ew-resize" },
  NorthWest: { top: 0, left: 0, width: 10, height: 10, cursor: "nwse-resize" },
  NorthEast: { top: 0, right: 0, width: 10, height: 10, cursor: "nesw-resize" },
  SouthWest: { bottom: 0, left: 0, width: 10, height: 10, cursor: "nesw-resize" },
  SouthEast: { bottom: 0, right: 0, width: 10, height: 10, cursor: "nwse-resize" },
};

type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  ready: Promise<string>;
  pending: { x: number; y: number } | null;
  sending: boolean;
  ended: boolean;
  endSent: boolean;
  frame: number;
  moved: boolean;
};

export function PinResizeHandles({ pinId, onScale, onResizingChange }: {
  pinId: string;
  onScale: (scale: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const callbacks = useRef({ onScale, onResizingChange });
  callbacks.current = { onScale, onResizingChange };

  const flush = async (gesture: Gesture) => {
    if (gesture.sending) return;
    gesture.sending = true;
    try {
      const token = await gesture.ready;
      while (gesture.pending) {
        const delta = gesture.pending;
        gesture.pending = null;
        const scale = await resizePin(pinId, token, delta.x, delta.y);
        if (gestureRef.current === gesture) callbacks.current.onScale(scale);
      }
      if (gesture.ended && !gesture.endSent) {
        gesture.endSent = true;
        await endPinResize(pinId, token);
      }
    } catch (error) {
      gesture.ended = true;
      gesture.pending = null;
      console.warn("Could not resize pin", error);
      const token = await gesture.ready.catch(() => null);
      if (token && !gesture.endSent) {
        gesture.endSent = true;
        await endPinResize(pinId, token).catch(() => {});
      }
    } finally {
      gesture.sending = false;
      if (gesture.ended && gestureRef.current === gesture) {
        gestureRef.current = null;
        callbacks.current.onResizingChange(false);
      }
    }
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>, direction: PinResizeDirection) => {
    if (event.button !== 0 || (gestureRef.current && !gestureRef.current.ended)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const gesture: Gesture = {
      pointerId: event.pointerId, x: event.screenX, y: event.screenY,
      ready: beginPinResize(pinId, direction), pending: null,
      sending: false, ended: false, endSent: false, frame: 0, moved: false,
    };
    gestureRef.current = gesture;
    callbacks.current.onResizingChange(true);
    void flush(gesture);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.ended || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.pending = { x: event.screenX - gesture.x, y: event.screenY - gesture.y };
    gesture.moved ||= gesture.pending.x !== 0 || gesture.pending.y !== 0;
    if (!gesture.frame) gesture.frame = requestAnimationFrame(() => { gesture.frame = 0; void flush(gesture); });
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.ended || gesture.pointerId !== event.pointerId) return;
    event.stopPropagation();
    gesture.ended = true;
    cancelAnimationFrame(gesture.frame);
    if (event.type === "pointerup" && (gesture.moved || event.screenX !== gesture.x || event.screenY !== gesture.y)) {
      gesture.pending = { x: event.screenX - gesture.x, y: event.screenY - gesture.y };
    }
    void flush(gesture);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => () => {
    const gesture = gestureRef.current;
    if (gesture) {
      gesture.ended = true;
      cancelAnimationFrame(gesture.frame);
      gestureRef.current = null;
      void flush(gesture);
    }
  }, [pinId]);

  return <>{(Object.keys(EDGES) as PinResizeDirection[]).map(direction => (
    <div key={direction} data-testid={`pin-resize-${direction}`} data-pin-resize={direction} aria-hidden="true"
      style={{ position: "absolute", zIndex: 10010, touchAction: "none", ...EDGES[direction] }}
      onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
      onPointerDown={event => start(event, direction)} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={finish} onLostPointerCapture={finish} />
  ))}</>;
}
