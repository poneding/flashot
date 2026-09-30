import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

const DRAG_THRESHOLD_PX = 3;

export function usePinDrag(startDragging: () => Promise<void>) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const startDraggingRef = useRef(startDragging);
  startDraggingRef.current = startDragging;
  const cancel = useCallback(() => { start.current = null; }, []);
  const handleMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    event.preventDefault();
    start.current = { x: event.clientX, y: event.clientY };
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!(event.buttons & 1)) {
        cancel();
        return;
      }
      const origin = start.current;
      if (!origin || (
        Math.abs(event.clientX - origin.x) < DRAG_THRESHOLD_PX &&
        Math.abs(event.clientY - origin.y) < DRAG_THRESHOLD_PX
      )) return;
      cancel();
      // Start on a real mousemove: AppKit then receives a drag event instead
      // of tao's synthetic mousedown with incorrectly mapped screen coordinates.
      void startDraggingRef.current().catch(error => console.warn("Could not drag pin", error));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  return { handleMouseDown, cancel };
}
