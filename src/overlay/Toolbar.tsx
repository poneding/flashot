import { TooltipBubble } from "@/annotation/Tooltip";
import { clampToolbarPosition, computeVerticalToolbarPosition } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import { CopyIcon, GripHorizontal, PinIcon, SaveIcon, TypeIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export const SCREENSHOT_TOOLBAR_RADIUS = 10;
export const SCREENSHOT_TOOLBAR_BACKGROUND = "rgba(30, 30, 30, 0.85)";
export const SCREENSHOT_TOOLBAR_BORDER = "1px solid rgba(255,255,255,0.1)";

const TOOLBAR_SIZE = { width: 40, height: 223 };

type ToolbarAction = () => void | Promise<void>;

type Props = {
  selection: Rect;
  monitorRect: Rect;
  onCopy: ToolbarAction;
  onSave: ToolbarAction;
  onPin: ToolbarAction;
  onClose: ToolbarAction;
  onScroll: ToolbarAction;
  onOcr: ToolbarAction;
  selectionTooSmall?: boolean;
};

type ToolbarButtonProps = {
  label: string;
  icon: ReactNode;
  onClick: ToolbarAction;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary" | "success";
};

const ACTION_COLORS: Record<NonNullable<ToolbarButtonProps["tone"]>, string> = {
  default: "rgba(255,255,255,0.78)",
  danger: "#f87171",
  primary: "#60a5fa",
  success: "#4ade80",
};

export function Toolbar({ selection, monitorRect, onCopy, onSave, onPin, onClose, onScroll, onOcr, selectionTooSmall }: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(TOOLBAR_SIZE.height);
  const [busy, setBusy] = useState(false);
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const toolbarSize = { width: TOOLBAR_SIZE.width, height: measuredHeight };
  const computedPos = computeVerticalToolbarPosition(selection, toolbarSize, monitorRect);
  const pos = customPos ? clampToolbarPosition(customPos, toolbarSize, monitorRect) : computedPos;

  useLayoutEffect(() => {
    const nextHeight = toolbarRef.current?.offsetHeight ?? 0;
    if (nextHeight > 0) setMeasuredHeight(nextHeight);
  });

  const runAction = async (action: ToolbarAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const startToolbarDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setCustomPos(
        clampToolbarPosition(
          { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
          toolbarSize,
          monitorRect,
        ),
      );
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={toolbarRef}
      data-screenshot-toolbar
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: TOOLBAR_SIZE.width,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "4px 0",
        borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
        background: SCREENSHOT_TOOLBAR_BACKGROUND,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        border: SCREENSHOT_TOOLBAR_BORDER,
        color: "#f0f0f5",
        pointerEvents: "auto",
        userSelect: "none",
        zIndex: 10000,
      }}
    >
      <div
        data-screenshot-toolbar-drag-handle
        title="Move toolbar"
        onMouseDown={startToolbarDrag}
        style={{
          position: "relative",
          width: 32,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.45)",
          cursor: "move",
          flexShrink: 0,
        }}
      >
        <GripHorizontal size={14} />
      </div>

      <Separator />

      <ToolbarGroup name="pin-scroll">
        <ToolbarButton
          label="Pin"
          icon={<PinIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          onClick={() => runAction(onPin)}
          disabled={busy}
        />
        <ToolbarButton
          label={selectionTooSmall ? "Selection too small" : "Scrolling screenshot"}
          icon={<ScrollScreenshotIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          onClick={() => runAction(onScroll)}
          disabled={selectionTooSmall}
        />
      </ToolbarGroup>

      <Separator />

      <ToolbarGroup name="close">
        <ToolbarButton
          label="Close"
          icon={<XIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          tone="danger"
          onClick={onClose}
        />
        <ToolbarButton
          label="Save As"
          icon={<SaveIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          tone="primary"
          onClick={() => runAction(onSave)}
          disabled={busy}
        />
        <ToolbarButton
          label={selectionTooSmall ? "Selection too small" : "Extract text (OCR)"}
          icon={<TypeIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          disabled={selectionTooSmall}
          onClick={() => runAction(onOcr)}
        />
        <ToolbarButton
          label="Copy"
          icon={<CopyIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
          tone="success"
          onClick={() => runAction(onCopy)}
          disabled={busy}
        />
      </ToolbarGroup>
    </div>
  );
}

function ScrollScreenshotIcon({ size = 24, strokeWidth = 2, ...props }: {
  size?: number | string;
  strokeWidth?: number | string;
  "aria-hidden"?: "true";
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="lucide lucide-chevrons-up-down-ellipsis-icon lucide-chevrons-up-down-ellipsis"
      data-scroll-screenshot-icon="vertical"
      {...props}
    >
      <path d="M12 8h.01" />
      <path d="M12 12h.01" />
      <path d="M12 16h.01" />
      <path d="m7 7 5-5 5 5" />
      <path d="m7 17 5 5 5-5" />
    </svg>
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  tone = "default",
}: ToolbarButtonProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const color = disabled ? "rgba(255,255,255,0.45)" : ACTION_COLORS[tone];

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled ? "true" : undefined}
      onClick={(e) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick();
      }}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      style={{
        position: "relative",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        borderRadius: 6,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
        color,
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {icon}
      {tooltipVisible && <TooltipBubble label={label} anchorRef={buttonRef} placement="right" />}
    </button>
  );
}

function ToolbarGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div
      data-screenshot-toolbar-group={name}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function Separator() {
  return <div style={separatorStyle} />;
}

const separatorStyle: CSSProperties = {
  width: 20,
  height: 1,
  background: "rgba(255,255,255,0.15)",
  margin: "4px 0",
  flexShrink: 0,
};
