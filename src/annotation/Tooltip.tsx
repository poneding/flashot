import { FLOATING_LABEL_BACKGROUND } from "@/lib/floating-surface";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const TOOLTIP_GAP = 4;
const TOOLTIP_VIEWPORT_PADDING = 6;
const TOOLTIP_SURFACE_SELECTOR = [
  "[data-annotation-toolbar]",
  "[data-annotation-property-panel]",
  "[data-image-adjustments-panel]",
  "[data-screenshot-toolbar]",
  "[data-pin-controls]",
].join(", ");

type TooltipBubbleProps = {
  label: string;
  anchorRef: { current: HTMLElement | null };
  placement?: "top" | "right" | "bottom" | "left";
};

export function TooltipBubble({ label, anchorRef, placement = "top" }: TooltipBubbleProps) {
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    transform: string;
  } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const surface = (anchor.closest(TOOLTIP_SURFACE_SELECTOR) as HTMLElement | null) ?? anchor;
      const surfaceRect = surface.getBoundingClientRect();
      const size = tooltipSize(label, bubbleRef.current);
      setPosition(computeTooltipPosition({
        anchorRect,
        surfaceRect,
        size,
        placement,
      }));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, label, placement]);

  const placementStyle: CSSProperties = position
    ? {
        position: "fixed",
        left: position.left,
        top: position.top,
        transform: position.transform,
      }
    : {
        position: "absolute",
        left: "50%",
        bottom: `calc(100% + ${TOOLTIP_GAP}px)`,
        transform: "translateX(-50%)",
      };

  return createPortal(
    <span
      ref={bubbleRef}
      role="tooltip"
      style={{
        ...placementStyle,
        padding: "5px 8px",
        borderRadius: 5,
        background: FLOATING_LABEL_BACKGROUND,
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

type TooltipPositionInput = {
  anchorRect: DOMRect;
  surfaceRect: DOMRect;
  size: { width: number; height: number };
  placement: NonNullable<TooltipBubbleProps["placement"]>;
};

function computeTooltipPosition({
  anchorRect,
  surfaceRect,
  size,
  placement,
}: TooltipPositionInput): { left: number; top: number; transform: string } {
  const viewportLeft = TOOLTIP_VIEWPORT_PADDING;
  const viewportTop = TOOLTIP_VIEWPORT_PADDING;
  const viewportRight = window.innerWidth - TOOLTIP_VIEWPORT_PADDING;
  const viewportBottom = window.innerHeight - TOOLTIP_VIEWPORT_PADDING;

  if (placement === "right" || placement === "left") {
    const rightFits = anchorRect.right + TOOLTIP_GAP + size.width <= viewportRight;
    const leftFits = anchorRect.left - TOOLTIP_GAP - size.width >= viewportLeft;
    const resolved =
      placement === "right"
        ? rightFits || !leftFits ? "right" : "left"
        : leftFits || !rightFits ? "left" : "right";

    return {
      left: resolved === "right" ? anchorRect.right + TOOLTIP_GAP : anchorRect.left - TOOLTIP_GAP,
      top: clamp(
        anchorRect.top + anchorRect.height / 2,
        viewportTop + size.height / 2,
        viewportBottom - size.height / 2,
      ),
      transform: resolved === "right" ? "translateY(-50%)" : "translate(-100%, -50%)",
    };
  }

  const topFits = surfaceRect.top - TOOLTIP_GAP - size.height >= viewportTop;
  const bottomFits = surfaceRect.bottom + TOOLTIP_GAP + size.height <= viewportBottom;
  const resolved =
    placement === "top"
      ? topFits || !bottomFits ? "top" : "bottom"
      : bottomFits || !topFits ? "bottom" : "top";

  return {
    left: clamp(
      anchorRect.left + anchorRect.width / 2,
      viewportLeft + size.width / 2,
      viewportRight - size.width / 2,
    ),
    top: resolved === "top" ? surfaceRect.top - TOOLTIP_GAP : surfaceRect.bottom + TOOLTIP_GAP,
    transform: resolved === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
  };
}

function tooltipSize(label: string, node: HTMLElement | null): { width: number; height: number } {
  const rect = node?.getBoundingClientRect();
  return {
    width: Math.max(rect?.width ?? 0, label.length * 6 + 16),
    height: Math.max(rect?.height ?? 0, 22),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}
