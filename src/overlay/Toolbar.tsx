import { computeToolbarPosition } from "@/lib/geometry";
import { cancelCapture, cropAndCopy, cropAndSave, pinImage } from "@/lib/ipc";
import { useOverlay } from "@/overlay/state";
import { CopyIcon, SaveIcon, XIcon, PinIcon, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";

const TB = { width: 148, height: 40 };

type ToolbarButtonProps = {
  label: string;
  icon: LucideIcon;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  variant?: "primary" | "default";
};

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  variant = "default",
}: ToolbarButtonProps) {
  const [showTitle, setShowTitle] = useState(false);
  const style = variant === "primary" ? primaryBtn : btn;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={style}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setShowTitle(true)}
      onMouseLeave={() => setShowTitle(false)}
      onFocus={() => setShowTitle(true)}
      onBlur={() => setShowTitle(false)}
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
      {showTitle && (
        <span role="tooltip" style={tooltip}>
          {label}
        </span>
      )}
    </button>
  );
}

export function Toolbar() {
  const mode = useOverlay((s) => s.mode);
  const sel = useOverlay((s) => s.selection);
  const monitor = useOverlay((s) => s.monitorRect);
  const monitorId = useOverlay((s) => s.monitorId);
  const [busy, setBusy] = useState(false);

  if (mode !== "committed" || !sel || !monitor || monitorId == null) return null;

  const pos = computeToolbarPosition(sel, TB, {
    x: 0,
    y: 0,
    width: monitor.width,
    height: monitor.height,
  });

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
  const onPin = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pinImage(monitorId, sel);
    } finally {
      setBusy(false);
    }
  };
  const onClose = async () => {
    await cancelCapture();
  };

  // Glass style — kept inline to avoid SSR/Tailwind backdrop issues with transparent windows
  const glass: CSSProperties = {
    position: "absolute",
    left: pos.x,
    top: pos.y,
    width: TB.width,
    height: TB.height,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "5px 8px",
    borderRadius: 8,
    background: "rgba(28,28,30,0.55)",
    backdropFilter: "blur(18px) saturate(160%)",
    WebkitBackdropFilter: "blur(18px) saturate(160%)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
    color: "#f0f0f5",
    fontSize: 12,
    pointerEvents: "auto",
  };

  return (
    <div style={glass} onMouseDown={(e) => e.stopPropagation()}>
      <ToolbarButton
        label="Copy"
        icon={CopyIcon}
        onClick={onCopy}
        disabled={busy}
        variant="primary"
      />
      <ToolbarButton label="Save As" icon={SaveIcon} onClick={onSave} disabled={busy} />
      <ToolbarButton label="Pin" icon={PinIcon} onClick={onPin} disabled={busy} />
      <ToolbarButton label="Close" icon={XIcon} onClick={onClose} />
    </div>
  );
}

const btn: CSSProperties = {
  position: "relative",
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: 6,
  background: "rgba(255,255,255,0.06)",
  border: "none",
  color: "#f0f0f5",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  ...btn,
  background: "linear-gradient(180deg,#5fb1ff,#3a8de8)",
  color: "white",
};

const tooltip: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: "calc(100% + 8px)",
  transform: "translateX(-50%)",
  padding: "4px 7px",
  borderRadius: 5,
  background: "rgba(12,12,14,0.92)",
  color: "#f7f7fb",
  fontSize: 11,
  lineHeight: 1,
  whiteSpace: "nowrap",
  boxShadow: "0 6px 18px rgba(0,0,0,0.32)",
  pointerEvents: "none",
};
