import { useLayoutEffect, useState } from "react";
import { resizePinToolWindow } from "@/lib/ipc";
import { fitPinToolContents, PIN_TOOL_PADDING } from "@/pin/floating-layout";
import type { PinToolKind } from "@/pin/types";

export function usePinToolBounds(pinId: string, kind: PinToolKind) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ left: PIN_TOOL_PADDING, top: PIN_TOOL_PADDING });

  useLayoutEffect(() => {
    if (!root) return;
    let stopped = false;
    let frame = 0;
    let last = "";
    let measured = false;
    let pending: ReturnType<typeof fitPinToolContents>["layout"] | null = null;
    let sending = false;
    const send = async () => {
      if (sending) return;
      sending = true;
      try {
        while (pending && !stopped) {
          const layout = pending;
          pending = null;
          await resizePinToolWindow(pinId, kind, layout);
        }
      } catch (error) {
        if (!stopped) console.warn("Could not size pin controls", error);
      } finally {
        sending = false;
      }
    };
    const measure = () => {
      frame = 0;
      const anchor = root.querySelector<HTMLElement>(kind === "controls" ? "[data-pin-controls]" : "[data-annotation-toolbar]");
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      if (!anchorRect.width || !anchorRect.height) return;
      measured = true;
      const surfaces = [...root.querySelectorAll<HTMLElement>("*"), ...document.querySelectorAll<HTMLElement>('[role="tooltip"]')]
        .filter(node => {
          const style = getComputedStyle(node);
          return (style.position === "fixed" || style.position === "absolute") && style.visibility !== "hidden";
        }).map(node => node.getBoundingClientRect());
      const fitted = fitPinToolContents(root.getBoundingClientRect(), anchorRect, surfaces);
      setOffset(current => current.left === fitted.offset.left && current.top === fitted.offset.top ? current : fitted.offset);
      const signature = JSON.stringify(fitted.layout);
      if (signature !== last) {
        last = signature;
        pending = fitted.layout;
        void send();
      }
    };
    const schedule = () => {
      if (stopped) return;
      // Hidden native webviews can pause rAF. Bootstrap their bounds before showing them.
      if (!measured) { measure(); return; }
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [root, pinId, kind]);

  // Portaled tooltips also need the new viewport-relative anchor after content moves.
  useLayoutEffect(() => { if (root) window.dispatchEvent(new Event("resize")); }, [root, offset]);
  return { setRoot, offset };
}
