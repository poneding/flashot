import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_GAP = 4;
const TOOLTIP_SURFACE_SELECTOR = "[data-annotation-toolbar], [data-annotation-property-panel]";

type TooltipBubbleProps = {
  label: string;
  anchorRef: { current: HTMLElement | null };
  placement?: "top" | "right";
};

export function TooltipBubble({ label, anchorRef, placement = "top" }: TooltipBubbleProps) {
  const [position, setPosition] = useState<{ left: number; top: number; placement: "top" | "right" } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    if (placement === "right") {
      setPosition({
        left: anchorRect.right + TOOLTIP_GAP,
        top: anchorRect.top + anchorRect.height / 2,
        placement,
      });
      return;
    }

    const surface = (anchor.closest(TOOLTIP_SURFACE_SELECTOR) as HTMLElement | null) ?? anchor;
    const surfaceRect = surface.getBoundingClientRect();

    setPosition({
      left: anchorRect.left + anchorRect.width / 2,
      top: surfaceRect.top - TOOLTIP_GAP,
      placement,
    });
  }, [anchorRef, label, placement]);

  const placementStyle: CSSProperties = position
    ? position.placement === "right"
      ? {
          position: "fixed",
          left: position.left,
          top: position.top,
          transform: "translateY(-50%)",
        }
      : {
          position: "fixed",
          left: position.left,
          top: position.top,
          transform: "translate(-50%, -100%)",
        }
    : {
        position: "absolute",
        left: "50%",
        bottom: `calc(100% + ${TOOLTIP_GAP}px)`,
        transform: "translateX(-50%)",
      };

  return createPortal(
    <span
      role="tooltip"
      style={{
        ...placementStyle,
        padding: "5px 8px",
        borderRadius: 5,
        background: "rgba(18,18,18,0.48)",
        color: "#fff",
        fontSize: 11,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxShadow: "0 4px 10px rgba(0,0,0,0.18)",
        border: "1px solid rgba(255,255,255,0.08)",
        pointerEvents: "none",
        zIndex: 10020,
      }}
    >
      {label}
    </span>,
    document.body,
  );
}
