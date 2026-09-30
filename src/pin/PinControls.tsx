import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, CopyIcon, ImageIcon, SaveIcon, Scaling, SquarePen, XIcon } from "lucide-react";
import { TooltipBubble } from "@/annotation/Tooltip";
import { createTranslator, type Locale } from "@/i18n";
import { ImageAdjustmentsPanel, type ImageAdjustmentControls } from "@/overlay/ImageAdjustmentsPanel";
import { pinScaleLabel as scaleLabel } from "@/pin/scale";

const PIN_CONTROLS_WIDTH = 40;
const PIN_CONTROLS_GAP = 8;
const PIN_ADJUSTMENTS_PANEL_WIDTH = 220;
type PinControlsSide = "left" | "right";
function shortcutTitle(action: string, key: string): string {
  const modifier = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform) ? "Cmd" : "Ctrl";
  return `${action} (${modifier}+${key})`;
}

type PinControlsProps = {
  adjustmentsControls?: ImageAdjustmentControls;
  scale: number;
  scaleOptions: number[];
  scaleMenuOpen: boolean;
  adjustmentsPanelOpen: boolean;
  controlsSide: PinControlsSide;
  copyConfirmed: boolean;
  editing: boolean;
  locale?: Locale;
  onToggleScaleMenu: () => void;
  onToggleAdjustmentsPanel: () => void;
  onScaleSelect: (scale: number) => void;
  onEdit: () => void;
  onClose: () => void;
  onSave: () => void;
  onCopy: () => void;
};

export function PinControls({
  adjustmentsControls,
  scale,
  scaleOptions,
  scaleMenuOpen,
  adjustmentsPanelOpen,
  controlsSide,
  copyConfirmed,
  editing,
  locale = "en",
  onToggleScaleMenu,
  onToggleAdjustmentsPanel,
  onScaleSelect,
  onEdit,
  onClose,
  onSave,
  onCopy,
}: PinControlsProps) {
  const t = createTranslator(locale);
  const editLabel = `${t("pin.edit")} (E)`;
  const adjustmentsLabel = t("screenshot.imageAdjustments");
  const scaleControlLabel = t("pin.scaleShortcut", { scale: scaleLabel(scale) });
  const closeLabel = `${t("screenshot.close")} (Esc)`;
  const saveLabel = shortcutTitle(t("screenshot.saveAs"), "S");
  const copyLabel = shortcutTitle(t("screenshot.copy"), "C");

  return (
    <div
      data-testid="pin-controls"
      data-pin-controls
      data-pin-controls-side={controlsSide}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={pinControlsBaseStyle}
    >
      <PinControlButton
        label={editLabel}
        placement={controlsSide}
        icon={<SquarePen size={18} aria-hidden="true" />}
        active={editing}
        onClick={onEdit}
      />
      <div style={{ position: "relative" }}>
        <PinControlButton
          label={adjustmentsLabel}
          placement={controlsSide}
          icon={<ImageIcon size={18} aria-hidden="true" />}
          active={adjustmentsPanelOpen}
          onClick={onToggleAdjustmentsPanel}
        />
        {adjustmentsPanelOpen && (
          <ImageAdjustmentsPanel
            controls={adjustmentsControls}
            locale={locale}
            style={pinAdjustmentsPanelStyleForSide(controlsSide)}
          />
        )}
      </div>
      <div style={{ position: "relative" }}>
        <PinControlButton
          label={scaleControlLabel}
          placement={controlsSide}
          icon={<Scaling size={18} aria-hidden="true" />}
          active={scaleMenuOpen}
          onClick={onToggleScaleMenu}
        />
        {scaleMenuOpen && (
          <div
            data-testid="pin-scale-options"
            className="flashot-dark-scrollbar"
            onWheel={(event) => event.stopPropagation()}
            style={pinScaleOptionsStyleForSide(controlsSide)}
          >
            {scaleOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={t("pin.scale", { scale: scaleLabel(option) })}
                onClick={() => onScaleSelect(option)}
                style={{
                  ...pinScaleOptionStyle,
                  background: option === scale ? "rgba(255,255,255,0.16)" : "transparent",
                }}
              >
                {scaleLabel(option)}
              </button>
            ))}
          </div>
        )}
      </div>
      <PinControlButton
        label={closeLabel}
        placement={controlsSide}
        icon={<XIcon size={18} aria-hidden="true" />}
        tone="danger"
        onClick={onClose}
      />
      <PinControlButton
        label={saveLabel}
        placement={controlsSide}
        icon={<SaveIcon size={18} aria-hidden="true" />}
        tone="primary"
        onClick={onSave}
      />
      <PinControlButton
        label={copyLabel}
        placement={controlsSide}
        icon={copyConfirmed ? <CheckIcon size={18} aria-hidden="true" /> : <CopyIcon size={18} aria-hidden="true" />}
        tone="success"
        onClick={onCopy}
      />
    </div>
  );
}

function PinControlButton({
  label,
  icon,
  onClick,
  active,
  placement,
  tone = "default",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  placement: PinControlsSide;
  tone?: "default" | "danger" | "primary" | "success";
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const color = {
    default: "rgba(255,255,255,0.78)",
    danger: "#f87171",
    primary: "#60a5fa",
    success: "#4ade80",
  }[tone];

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      style={{
        ...pinControlButtonStyle,
        background: active ? "rgba(255,255,255,0.16)" : "transparent",
        color,
      }}
    >
      {icon}
      {tooltipVisible && <TooltipBubble label={label} anchorRef={buttonRef} placement={placement} />}
    </button>
  );
}

const pinControlsBaseStyle: CSSProperties = {
  position: "relative",
  width: PIN_CONTROLS_WIDTH,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "4px 0",
  borderRadius: 10,
  background: "rgb(30, 30, 30)",
  boxShadow: "none",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#f0f0f5",
  pointerEvents: "auto",
  cursor: "default",
  userSelect: "none",
  zIndex: 10,
};

const pinControlButtonStyle: CSSProperties = {
  position: "relative",
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
};

function pinScaleOptionsStyleForSide(side: PinControlsSide): CSSProperties {
  return {
    position: "absolute",
    ...(side === "right"
      ? { left: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }
      : { right: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }),
    top: 0,
    width: 72,
    maxHeight: 220,
    overflowY: "auto",
    overflowX: "hidden",
    padding: 4,
    borderRadius: 8,
    background: "rgba(30, 30, 30, 0.95)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "none",
  };
}

function pinAdjustmentsPanelStyleForSide(side: PinControlsSide): CSSProperties {
  return {
    position: "absolute",
    ...(side === "right"
      ? { left: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }
      : { right: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }),
    top: 0,
    width: PIN_ADJUSTMENTS_PANEL_WIDTH,
    background: "rgb(30, 30, 30)",
    boxShadow: "none",
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
  };
}

const pinScaleOptionStyle: CSSProperties = {
  width: "100%",
  height: 24,
  border: "none",
  borderRadius: 5,
  color: "#fff",
  cursor: "pointer",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};
