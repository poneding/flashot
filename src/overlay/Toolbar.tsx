import { useState } from "react";
import { useOverlay } from "@/overlay/state";
import { computeToolbarPosition } from "@/lib/geometry";
import { cropAndCopy, cropAndSave, cancelCapture } from "@/lib/ipc";

const TB = { width: 200, height: 40 };

export function Toolbar() {
  const mode = useOverlay((s) => s.mode);
  const sel = useOverlay((s) => s.selection);
  const monitor = useOverlay((s) => s.monitorRect);
  const monitorId = useOverlay((s) => s.monitorId);
  const [busy, setBusy] = useState(false);

  if (mode !== "committed" || !sel || !monitor || monitorId == null) return null;

  const pos = computeToolbarPosition(sel, TB, { x: 0, y: 0, width: monitor.width, height: monitor.height });

  const onCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cropAndCopy(monitorId, sel);
    } finally {
      setBusy(false);
    }
  };
  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cropAndSave(monitorId, sel);
    } finally {
      setBusy(false);
    }
  };
  const onClose = async () => {
    await cancelCapture();
  };

  // Glass style — kept inline to avoid SSR/Tailwind backdrop issues with transparent windows
  const glass: React.CSSProperties = {
    position: "absolute",
    left: pos.x,
    top: pos.y,
    width: TB.width,
    height: TB.height,
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 7px",
    borderRadius: 10,
    background: "rgba(28,28,30,0.55)",
    backdropFilter: "blur(18px) saturate(160%)",
    WebkitBackdropFilter: "blur(18px) saturate(160%)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
    color: "#f0f0f5",
    fontSize: 12,
    pointerEvents: "auto",
  };

  const btn: React.CSSProperties = {
    height: 26,
    padding: "0 10px",
    borderRadius: 6,
    background: "rgba(255,255,255,0.06)",
    border: "none",
    color: "#f0f0f5",
    cursor: "pointer",
  };
  const primaryBtn: React.CSSProperties = {
    ...btn,
    background: "linear-gradient(180deg,#5fb1ff,#3a8de8)",
    color: "white",
  };

  return (
    <div style={glass} onMouseDown={(e) => e.stopPropagation()}>
      <button style={primaryBtn} onClick={onCopy} disabled={busy}>Copy</button>
      <button style={btn} onClick={onSave} disabled={busy}>Save As</button>
      <button style={btn} onClick={onClose}>Close</button>
    </div>
  );
}
