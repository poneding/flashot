import { useDismissOnOutsideMouseDown } from "@/lib/useDismissOnOutsideMouseDown";
import type { CSSProperties, RefObject } from "react";

const PANEL_BACKGROUND = "rgba(30, 30, 30, 0.95)";

type Props = {
  panelRef: RefObject<HTMLDivElement>;
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
  ignoreDismissRef?: RefObject<HTMLElement>;
  style?: CSSProperties;
};

export function CornerRadiusPanel({ panelRef, value, onChange, onDismiss, ignoreDismissRef, style }: Props) {
  useDismissOnOutsideMouseDown(true, panelRef, onDismiss, { ignoreRef: ignoreDismissRef });

  return (
    <div
      ref={panelRef}
      data-corner-radius-panel
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        alignItems: "center",
        boxSizing: "border-box",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        background: PANEL_BACKGROUND,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.85)",
        fontSize: 12,
        userSelect: "none",
        zIndex: 10001,
        ...style,
      }}
    >
      <input
        type="range"
        min={0}
        max={60}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Corner radius"
        style={{
          width: 160,
          accentColor: "#60a5fa",
        }}
      />
      <span
        style={{
          minWidth: 36,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value} px
      </span>
    </div>
  );
}
