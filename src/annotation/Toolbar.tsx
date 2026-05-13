import { useState } from "react";
import {
  MousePointer2,
  Pencil,
  Minus,
  Square,
  Circle,
  Type,
  Droplets,
  Highlighter,
  Eraser,
  Undo2,
  Redo2,
  Copy,
  Save,
  X,
} from "lucide-react";
import { computeToolbarPosition } from "@/lib/geometry";
import { useAnnotation } from "@/annotation/store";
import { PropertyPanel } from "@/annotation/PropertyPanel";
import type { ToolType } from "@/annotation/types";
import type { Rect } from "@/lib/types";

const TOOLBAR_SIZE = { width: 460, height: 40 };

type ToolDef = {
  id: ToolType;
  icon: React.ReactNode;
  label: string;
};

const TOOLS: ToolDef[] = [
  { id: "select", icon: <MousePointer2 size={18} />, label: "Select" },
  { id: "draw", icon: <Pencil size={18} />, label: "Pen" },
  { id: "line", icon: <Minus size={18} />, label: "Line" },
  { id: "rect", icon: <Square size={18} />, label: "Rectangle" },
  { id: "ellipse", icon: <Circle size={18} />, label: "Ellipse" },
  { id: "text", icon: <Type size={18} />, label: "Text" },
  { id: "blur", icon: <Droplets size={18} />, label: "Blur" },
  { id: "highlight", icon: <Highlighter size={18} />, label: "Highlight" },
  { id: "eraser", icon: <Eraser size={18} />, label: "Eraser" },
];

type Props = {
  selection: Rect;
  monitorRect: Rect;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function Toolbar({ selection, monitorRect, onCopy, onSave, onClose }: Props) {
  const { activeTool, setActiveTool, canUndo, canRedo, undo, redo } = useAnnotation();
  const [showPanel, setShowPanel] = useState(false);

  const pos = computeToolbarPosition(selection, TOOLBAR_SIZE, monitorRect);

  function handleToolClick(tool: ToolType) {
    if (tool === "select" || tool === "eraser") {
      setActiveTool(tool);
      setShowPanel(false);
      return;
    }
    if (tool === activeTool) {
      setShowPanel((v) => !v);
    } else {
      setActiveTool(tool);
      setShowPanel(true);
    }
  }

  const panelOffset = TOOLBAR_SIZE.height + 6;

  return (
    <>
      {/* Property panel */}
      {showPanel && activeTool !== "select" && activeTool !== "eraser" && (
        <PropertyPanel
          tool={activeTool}
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.kind === "above" ? pos.y - panelOffset : pos.y + panelOffset,
            zIndex: 10001,
          }}
        />
      )}

      {/* Toolbar */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: TOOLBAR_SIZE.width,
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

        <Separator />

        {/* Group 2: Undo / Redo */}
        <ActionButton
          icon={<Undo2 size={18} />}
          label="Undo"
          disabled={!canUndo}
          onClick={undo}
        />
        <ActionButton
          icon={<Redo2 size={18} />}
          label="Redo"
          disabled={!canRedo}
          onClick={redo}
        />

        <Separator />

        {/* Group 3: Output */}
        <ActionButton
          icon={<Copy size={18} />}
          label="Copy"
          onClick={onCopy}
          primary
        />
        <ActionButton icon={<Save size={18} />} label="Save" onClick={onSave} />
        <ActionButton icon={<X size={18} />} label="Close" onClick={onClose} />
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
  return (
    <button
      title={label}
      onClick={onClick}
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
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
};

function ActionButton({ icon, label, disabled, onClick, primary }: ActionButtonProps) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        background: primary ? "#3b82f6" : "transparent",
        color: "#fff",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        transition: "background 0.1s, opacity 0.1s",
      }}
    >
      {icon}
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
