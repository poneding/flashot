import { useDismissOnOutsideMouseDown } from "@/lib/useDismissOnOutsideMouseDown";
import type { CSSProperties, RefObject } from "react";

const PANEL_BACKGROUND = "rgba(30, 30, 30, 0.95)";
const CORNER_RADIUS_OPTIONS = Array.from({ length: 61 }, (_, index) => index);
const DARK_SCROLLBAR_STYLE: CSSProperties = {
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255, 255, 255, 0.32) rgba(255, 255, 255, 0.08)",
  colorScheme: "dark",
  background: PANEL_BACKGROUND,
  borderRadius: 4,
};

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
        padding: 4,
        borderRadius: 6,
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
      <div
        data-testid="screenshot-corner-radius-list"
        className="flashot-dark-scrollbar"
        style={{
          maxHeight: 200,
          overflowY: "auto",
          overflowX: "hidden",
          width: "100%",
          ...DARK_SCROLLBAR_STYLE,
        }}
      >
        {CORNER_RADIUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Corner radius: ${option} px`}
            onClick={() => {
              onChange(option);
              onDismiss();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              border: "none",
              borderRadius: 5,
              height: 24,
              boxSizing: "border-box",
              padding: "3px 6px",
              background: option === value ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {option} px
          </button>
        ))}
      </div>
    </div>
  );
}
