import { TooltipBubble } from "@/annotation/Tooltip";
import { useAnnotation } from "@/annotation/store";
import { clampToolbarPosition, computeVerticalToolbarPosition } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import { CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";
import { ImageAdjustmentsPanel } from "@/overlay/ImageAdjustmentsPanel";
import { useOverlay } from "@/overlay/state";
import { CopyIcon, GripHorizontal, PinIcon, Pipette, SaveIcon, SlidersHorizontal, SquareRoundCorner, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

export const SCREENSHOT_TOOLBAR_RADIUS = 10;
export const SCREENSHOT_TOOLBAR_BACKGROUND = "rgba(30, 30, 30, 0.85)";
export const SCREENSHOT_TOOLBAR_BORDER = "1px solid rgba(255,255,255,0.1)";

const TOOLBAR_SIZE = { width: 40, height: 308 };
const RADIUS_PANEL_WIDTH = 72;
const RADIUS_PANEL_HEIGHT = 218;
const RADIUS_PANEL_GAP = 8;
const ADJUSTMENTS_PANEL_WIDTH = 220;
const ADJUSTMENTS_PANEL_HEIGHT = 220;
const ADJUSTMENTS_PANEL_GAP = 8;

type ToolbarAction = () => void | Promise<void>;

type Props = {
  selection: Rect;
  monitorRect: Rect;
  onCopy: ToolbarAction;
  onSave: ToolbarAction;
  onPin: ToolbarAction;
  onClose: ToolbarAction;
  onScroll: ToolbarAction;
  scrollSelectionTooSmall?: boolean;
};

type ToolbarButtonProps = {
  label: string;
  icon: ReactNode;
  onClick: ToolbarAction;
  buttonRef?: RefObject<HTMLButtonElement>;
  disabled?: boolean;
  active?: boolean;
  tone?: "default" | "danger" | "primary" | "success";
};

const ACTION_COLORS: Record<NonNullable<ToolbarButtonProps["tone"]>, string> = {
  default: "rgba(255,255,255,0.78)",
  danger: "#f87171",
  primary: "#60a5fa",
  success: "#4ade80",
};

export function Toolbar({
  selection,
  monitorRect,
  onCopy,
  onSave,
  onPin,
  onClose,
  onScroll,
  scrollSelectionTooSmall,
}: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const radiusPanelRef = useRef<HTMLDivElement>(null);
  const radiusButtonRef = useRef<HTMLButtonElement>(null);
  const adjustmentsPanelRef = useRef<HTMLDivElement>(null);
  const adjustmentsButtonRef = useRef<HTMLButtonElement>(null);
  const cornerRadius = useOverlay((s) => s.cornerRadius);
  const setCornerRadius = useOverlay((s) => s.setCornerRadius);
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  const toggleColorPicker = useOverlay((s) => s.toggleColorPicker);
  const setActiveTool = useAnnotation((s) => s.setActiveTool);
  const [measuredHeight, setMeasuredHeight] = useState(TOOLBAR_SIZE.height);
  const [busy, setBusy] = useState(false);
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(null);
  const [radiusPanelOpen, setRadiusPanelOpen] = useState(false);
  const [adjustmentsPanelOpen, setAdjustmentsPanelOpen] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const toolbarSize = { width: TOOLBAR_SIZE.width, height: measuredHeight };
  const computedPos = computeVerticalToolbarPosition(selection, toolbarSize, monitorRect);
  const pos = customPos ? clampToolbarPosition(customPos, toolbarSize, monitorRect) : computedPos;
  const radiusPanelPosition = computeSidePanelPosition(pos, monitorRect, RADIUS_PANEL_WIDTH, RADIUS_PANEL_HEIGHT, RADIUS_PANEL_GAP);
  const adjustmentsPanelPosition = computeSidePanelPosition(
    pos,
    monitorRect,
    ADJUSTMENTS_PANEL_WIDTH,
    ADJUSTMENTS_PANEL_HEIGHT,
    ADJUSTMENTS_PANEL_GAP,
  );

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

  function handleColorPickerClick() {
    const willShowPicker = !colorPickerVisible;
    toggleColorPicker();

    if (willShowPicker) {
      setActiveTool("select");
    }
  }

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
    <>
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

        <ToolbarGroup name="radius">
          <ToolbarButton
            buttonRef={radiusButtonRef}
            label={`Corner radius: ${cornerRadius} px`}
            icon={<SquareRoundCorner size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => {
              setAdjustmentsPanelOpen(false);
              setRadiusPanelOpen((open) => !open);
            }}
          />
        </ToolbarGroup>

        <Separator />

        <ToolbarGroup name="pin-scroll">
          <ToolbarButton
            label="Pin"
            icon={<PinIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => runAction(onPin)}
            disabled={busy}
          />
          <ToolbarButton
            label="Color Picker"
            icon={<Pipette size={18} strokeWidth={2.2} aria-hidden="true" />}
            active={colorPickerVisible}
            onClick={handleColorPickerClick}
          />
          <ToolbarButton
            buttonRef={adjustmentsButtonRef}
            label="Image adjustments"
            icon={<SlidersHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
            active={adjustmentsPanelOpen}
            onClick={() => {
              setRadiusPanelOpen(false);
              setAdjustmentsPanelOpen((open) => !open);
            }}
          />
          <ToolbarButton
            label={scrollSelectionTooSmall ? "Selection too small" : "Scrolling screenshot"}
            icon={<ScrollScreenshotIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => runAction(onScroll)}
            disabled={scrollSelectionTooSmall}
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
            label="Copy"
            icon={<CopyIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            tone="success"
            onClick={() => runAction(onCopy)}
            disabled={busy}
          />
        </ToolbarGroup>
      </div>

      {radiusPanelOpen && (
        <CornerRadiusPanel
          panelRef={radiusPanelRef}
          value={cornerRadius}
          onChange={setCornerRadius}
          onDismiss={() => setRadiusPanelOpen(false)}
          ignoreDismissRef={radiusButtonRef}
          style={{
            position: "fixed",
            left: radiusPanelPosition.left,
            top: radiusPanelPosition.top,
            width: RADIUS_PANEL_WIDTH,
          }}
        />
      )}

      {adjustmentsPanelOpen && (
        <ImageAdjustmentsPanel
          panelRef={adjustmentsPanelRef}
          style={{
            position: "fixed",
            left: adjustmentsPanelPosition.left,
            top: adjustmentsPanelPosition.top,
            width: ADJUSTMENTS_PANEL_WIDTH,
          }}
        />
      )}
    </>
  );
}

function computeSidePanelPosition(
  toolbarPos: { x: number; y: number },
  monitorRect: Rect,
  panelWidth: number,
  panelHeight: number,
  gap: number,
): { left: number; top: number } {
  const monitorLeft = monitorRect.x;
  const monitorTop = monitorRect.y;
  const monitorRight = monitorRect.x + monitorRect.width;
  const monitorBottom = monitorRect.y + monitorRect.height;

  if (toolbarPos.x >= monitorLeft + panelWidth + gap) {
    return {
      left: toolbarPos.x - panelWidth - gap,
      top: clamp(
        toolbarPos.y + 4,
        monitorTop + gap,
        monitorBottom - panelHeight - gap,
      ),
    };
  }

  return {
    left: clamp(
      toolbarPos.x,
      monitorLeft + gap,
      monitorRight - panelWidth - gap,
    ),
    top: clamp(
      toolbarPos.y - panelHeight - gap,
      monitorTop + gap,
      monitorBottom - panelHeight - gap,
    ),
  };
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
  buttonRef: providedButtonRef,
  disabled,
  active,
  tone = "default",
}: ToolbarButtonProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const internalButtonRef = useRef<HTMLButtonElement>(null);
  const buttonRef = providedButtonRef ?? internalButtonRef;
  const color = disabled ? "rgba(255,255,255,0.45)" : ACTION_COLORS[tone];

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
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
        background: active ? "rgba(255,255,255,0.16)" : "transparent",
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

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}
