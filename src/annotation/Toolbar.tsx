import { PropertyPanel } from "@/annotation/PropertyPanel";
import { useAnnotation } from "@/annotation/store";
import { TooltipBubble } from "@/annotation/Tooltip";
import { useOverlay } from "@/overlay/state";
import type { ToolType } from "@/annotation/types";
import { clampToolbarPosition, computeToolbarPosition } from "@/lib/geometry";
import type { Rect } from "@/lib/types";
import {
  Circle,
  Droplets,
  Eraser,
  GripVertical,
  Highlighter,
  MoveUpRight,
  Pipette,
  Pencil,
  Redo2,
  Ruler,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

const TOOLBAR_SIZE = { width: 0, height: 40 };
const PROPERTY_PANEL_GAP = 4;

type ToolDef = {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
};

const TOOLS: ToolDef[] = [
  { id: "draw", icon: <Pencil size={18} />, label: "Pen" },
  { id: "line", icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="5" /></svg>, label: "Line" },
  { id: "measure", icon: <Ruler size={18} />, label: "Measure" },
  { id: "arrow", icon: <MoveUpRight size={18} />, label: "Arrow" },
  { id: "rect", icon: <Square size={18} />, label: "Rectangle" },
  { id: "ellipse", icon: <Circle size={18} />, label: "Ellipse" },
  { id: "text", icon: <Type size={18} />, label: "Text" },
  { id: "blur", icon: <Droplets size={18} />, label: "Blur" },
  { id: "highlight", icon: <Highlighter size={18} />, label: "Highlight" },
  { id: "eraser", icon: <Eraser size={18} />, label: "Eraser" },
];

function shortcutTitle(action: string, key: string, options: { shift?: boolean } = {}): string {
  const isMac = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return `${action} (${modifier}+${options.shift ? "Shift+" : ""}${key})`;
}

type Props = {
  selection: Rect;
  monitorRect: Rect;
};

export function Toolbar({ selection, monitorRect }: Props) {
  const { activeTool, setActiveTool, canUndo, canRedo, undo, redo } = useAnnotation();
  const colorPickerVisible = useOverlay((s) => s.colorPickerVisible);
  const toggleColorPicker = useOverlay((s) => s.toggleColorPicker);
  const hideColorPicker = useOverlay((s) => s.hideColorPicker);
  const objects = useAnnotation((s) => s.objects);
  const selectedObjectId = useAnnotation((s) => s.selectedObjectId);
  const [showPanel, setShowPanel] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const propertyPanelRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(TOOLBAR_SIZE.width);
  const [propertyPanelHeight, setPropertyPanelHeight] = useState(TOOLBAR_SIZE.height);
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const selectedObject = objects.find((obj) => obj.id === selectedObjectId);

  useLayoutEffect(() => {
    if (toolbarRef.current) {
      setMeasuredWidth(toolbarRef.current.offsetWidth);
    }
    if (propertyPanelRef.current) {
      const nextHeight = propertyPanelRef.current.offsetHeight;
      if (nextHeight > 0) setPropertyPanelHeight(nextHeight);
    }
  });

  const computedPos = computeToolbarPosition(selection, { width: measuredWidth, height: TOOLBAR_SIZE.height }, monitorRect);
  const toolbarSize = { width: measuredWidth, height: TOOLBAR_SIZE.height };
  const pos = customPos ? clampToolbarPosition(customPos, toolbarSize, monitorRect) : computedPos;

  function handleToolClick(tool: ToolType) {
    hideColorPicker();

    if (tool === activeTool) {
      setActiveTool("select");
      setShowPanel(false);
      return;
    }

    setActiveTool(tool);
    setShowPanel(tool !== "eraser");
  }

  function handleColorPickerClick() {
    const willShowPicker = !colorPickerVisible;
    toggleColorPicker();

    if (willShowPicker) {
      setActiveTool("select");
      setShowPanel(false);
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
      setCustomPos(clampToolbarPosition(
        { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
        toolbarSize,
        monitorRect,
      ));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const panelTool = selectedObject?.type ?? activeTool;
  const shouldShowPanel = Boolean(selectedObject) || (showPanel && activeTool !== "select" && activeTool !== "eraser");
  const undoTitle = shortcutTitle("Undo", "Z");
  const redoTitle = shortcutTitle("Redo", "Z", { shift: true });
  const panelTop = (() => {
    const belowY = pos.y + TOOLBAR_SIZE.height + PROPERTY_PANEL_GAP;
    if (belowY + propertyPanelHeight > window.innerHeight) {
      return pos.y - propertyPanelHeight - PROPERTY_PANEL_GAP;
    }
    return belowY;
  })();

  return (
    <>
      {/* Property panel */}
      {shouldShowPanel && panelTool !== "select" && panelTool !== "eraser" && (
        <PropertyPanel
          panelRef={propertyPanelRef}
          tool={panelTool}
          object={selectedObject}
          style={{
            position: "fixed",
            left: pos.x,
            top: panelTop,
            zIndex: 10001,
          }}
        />
      )}

      {/* Toolbar */}
      <div
        ref={toolbarRef}
        data-annotation-toolbar
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          height: TOOLBAR_SIZE.height,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          borderRadius: 10,
          background: "rgba(30, 30, 30, 0.85)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.1)",
          zIndex: 10000,
          userSelect: "none",
        }}
      >
        <div
          data-annotation-toolbar-drag-handle
          onMouseDown={startToolbarDrag}
          style={{
            position: "relative",
            width: 16,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.45)",
            cursor: "move",
            flexShrink: 0,
          }}
        >
          <GripVertical size={14} />
        </div>

        <Separator />

        {/* Group 1: Tool buttons */}
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            active={activeTool === tool.id}
            onClick={() => handleToolClick(tool.id)}
          />
        ))}
        <ToolButton
          icon={<Pipette size={18} />}
          label="Color Picker"
          active={colorPickerVisible}
          onClick={handleColorPickerClick}
        />

        <Separator />

        {/* Group 2: Undo / Redo */}
        <ActionButton
          icon={<Undo2 size={18} />}
          label={undoTitle}
          disabled={!canUndo}
          onClick={undo}
        />
        <ActionButton
          icon={<Redo2 size={18} />}
          label={redoTitle}
          disabled={!canRedo}
          onClick={redo}
        />
      </div>
    </>
  );
}

// --- Sub-components ---

type ToolButtonProps = {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
};

function ToolButton({ icon, label, active, onClick }: ToolButtonProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      onClick={onClick}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      style={{
        position: "relative",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        background: active ? "rgba(255,255,255,0.15)" : "transparent",
        color: active ? "#fff" : "rgba(255,255,255,0.7)",
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {icon}
      {tooltipVisible && <TooltipBubble label={label} anchorRef={buttonRef} />}
      {active && (
        <span
          style={{
            position: "absolute",
            bottom: 2,
            left: "50%",
            transform: "translateX(-50%)",
            width: 12,
            height: 2,
            borderRadius: 1,
            background: "#3b82f6",
          }}
        />
      )}
    </button>
  );
}

type ActionButtonProps = {
  icon: React.ReactNode;
  label: string;
  tone?: "default" | "danger" | "primary" | "success";
  disabled?: boolean;
  onClick: () => void;
};

const ACTION_COLORS: Record<NonNullable<ActionButtonProps["tone"]>, string> = {
  default: "rgba(255,255,255,0.7)",
  danger: "#f87171",
  primary: "#60a5fa",
  success: "#4ade80",
};

function ActionButton({ icon, label, tone = "default", disabled, onClick }: ActionButtonProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const color = disabled ? "rgba(255,255,255,0.45)" : ACTION_COLORS[tone];

  return (
    <button
      ref={buttonRef}
      type="button"
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
      style={{
        position: "relative",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        background: "transparent",
        color,
        flexShrink: 0,
        transition: "background 0.1s, color 0.1s, opacity 0.1s",
      }}
    >
      {icon}
      {tooltipVisible && <TooltipBubble label={label} anchorRef={buttonRef} />}
    </button>
  );
}

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 20,
        background: "rgba(255,255,255,0.15)",
        margin: "0 4px",
        flexShrink: 0,
      }}
    />
  );
}
