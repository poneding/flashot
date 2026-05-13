import type { CSSProperties } from "react";
import type { ToolType } from "@/annotation/types";

type Props = {
  tool: ToolType;
  style?: CSSProperties;
};

export function PropertyPanel({ tool, style }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 8,
        background: "rgba(30, 30, 30, 0.85)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.8)",
        fontSize: 12,
        ...style,
      }}
    >
      <span>{tool} properties (TODO)</span>
    </div>
  );
}
