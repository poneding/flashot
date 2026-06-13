import { useAnnotation } from "@/annotation/store";
import { TooltipBubble } from "@/annotation/Tooltip";
import { createTranslator, type Locale } from "@/i18n";
import { clampToolbarPosition, computeSidePanelPosition, computeVerticalToolbarPosition } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import { CORNER_RADIUS_PANEL_SIZE, CornerRadiusPanel } from "@/overlay/CornerRadiusPanel";
import { ImageAdjustmentsPanel } from "@/overlay/ImageAdjustmentsPanel";
import { useOverlay } from "@/overlay/state";
import { CopyIcon, GripHorizontal, Image, PinIcon, Pipette, SaveIcon, Scroll, SquareRoundCorner, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

export const SCREENSHOT_TOOLBAR_RADIUS = 10;
export const SCREENSHOT_TOOLBAR_BACKGROUND = "rgba(30, 30, 30, 0.85)";
export const SCREENSHOT_TOOLBAR_BORDER = "1px solid rgba(255,255,255,0.1)";

const TOOLBAR_SIZE = { width: 40, height: 308 };
const SIDE_PANEL_GAP = 8;
const ADJUSTMENTS_PANEL_SIZE = { width: 220, height: 220 };

function shortcutTitle(action: string, key: string): string {
  const isMac = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return `${action} (${modifier}+${key})`;
}

type ToolbarAction = () => void | Promise<void>;

type Props = {
  selection: Rect;
  monitorRect: Rect;
  locale?: Locale;
  onCopy: ToolbarAction;
  onSave: ToolbarAction;
  onPin: ToolbarAction;
  onClose: ToolbarAction;
  onScroll: ToolbarAction;
  scrollSelectionTooSmall?: boolean;
};

type ToolbarButtonProps = {
  label: string;
  tooltipLabel?: string;
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
  locale = "en",
  onCopy,
  onSave,
  onPin,
  onClose,
  onScroll,
  scrollSelectionTooSmall,
}: Props) {
  const t = createTranslator(locale);
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
  const radiusPanelPosition = computeSidePanelPosition(pos, monitorRect, CORNER_RADIUS_PANEL_SIZE, SIDE_PANEL_GAP);
  const adjustmentsPanelPosition = computeSidePanelPosition(
    pos,
    monitorRect,
    ADJUSTMENTS_PANEL_SIZE,
    SIDE_PANEL_GAP,
  );
  const closeLabel = `${t("screenshot.close")} (Esc)`;
  const saveLabel = shortcutTitle(t("screenshot.saveAs"), "S");
  const copyLabel = shortcutTitle(t("screenshot.copy"), "C");

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
            label={t("screenshot.cornerRadius", { value: cornerRadius })}
            tooltipLabel={t("screenshot.cornerRadiusUnit")}
            icon={<SquareRoundCorner size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => {
              setAdjustmentsPanelOpen(false);
              setRadiusPanelOpen((open) => !open);
            }}
          />
        </ToolbarGroup>

        <ToolbarGroup name="pin-scroll">
          <ToolbarButton
            label={t("screenshot.pin")}
            icon={<PinIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => runAction(onPin)}
            disabled={busy}
          />
          <ToolbarButton
            label={t("screenshot.colorPicker")}
            icon={<Pipette size={18} strokeWidth={2.2} aria-hidden="true" />}
            active={colorPickerVisible}
            onClick={handleColorPickerClick}
          />
          <ToolbarButton
            buttonRef={adjustmentsButtonRef}
            label={t("screenshot.imageAdjustments")}
            icon={<Image size={18} strokeWidth={2.2} aria-hidden="true" />}
            active={adjustmentsPanelOpen}
            onClick={() => {
              setRadiusPanelOpen(false);
              setAdjustmentsPanelOpen((open) => !open);
            }}
          />
          <ToolbarButton
            label={scrollSelectionTooSmall ? t("screenshot.selectionTooSmall") : t("screenshot.scrollingScreenshot")}
            icon={<Scroll size={18} strokeWidth={2.2} aria-hidden="true" />}
            onClick={() => runAction(onScroll)}
            disabled={scrollSelectionTooSmall}
          />
        </ToolbarGroup>

        <Separator />

        <ToolbarGroup name="close">
          <ToolbarButton
            label={closeLabel}
            icon={<XIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            tone="danger"
            onClick={onClose}
          />
          <ToolbarButton
            label={saveLabel}
            icon={<SaveIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            tone="primary"
            onClick={() => runAction(onSave)}
            disabled={busy}
          />
          <ToolbarButton
            label={copyLabel}
            icon={<CopyIcon size={18} strokeWidth={2.2} aria-hidden="true" />}
            tone="success"
            onClick={() => runAction(onCopy)}
            disabled={busy}
          />
        </ToolbarGroup>
      </div>

      {radiusPanelOpen && (
        <CornerRadiusPanel
          locale={locale}
          panelRef={radiusPanelRef}
          value={cornerRadius}
          onChange={setCornerRadius}
          onDismiss={() => setRadiusPanelOpen(false)}
          ignoreDismissRef={radiusButtonRef}
          style={{
            position: "fixed",
            left: radiusPanelPosition.left,
            top: radiusPanelPosition.top,
          }}
        />
      )}

      {adjustmentsPanelOpen && (
        <ImageAdjustmentsPanel
          locale={locale}
          panelRef={adjustmentsPanelRef}
          style={{
            position: "fixed",
            left: adjustmentsPanelPosition.left,
            top: adjustmentsPanelPosition.top,
            width: ADJUSTMENTS_PANEL_SIZE.width,
          }}
        />
      )}
    </>
  );
}

function ToolbarButton({
  label,
  tooltipLabel,
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
      {tooltipVisible && <TooltipBubble label={tooltipLabel ?? label} anchorRef={buttonRef} placement="right" />}
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
