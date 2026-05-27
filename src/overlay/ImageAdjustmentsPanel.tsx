import { useOverlay } from "@/overlay/state";
import type { ImageAdjustments } from "@/lib/types";
import {
  Contrast,
  Droplets,
  RotateCcw,
  Sparkles,
  SunMedium,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, Ref } from "react";

const PANEL_BACKGROUND = "rgba(30, 30, 30, 0.95)";

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
  boxSizing: "border-box",
  borderRadius: 8,
  background: PANEL_BACKGROUND,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.82)",
  userSelect: "none",
  zIndex: 10001,
};

const iconButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  borderRadius: 6,
  color: "rgba(255,255,255,0.78)",
  cursor: "pointer",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "20px 1fr 34px",
  alignItems: "center",
  gap: 8,
};

const rangeStyle: CSSProperties = {
  width: "100%",
  accentColor: "var(--flashot-accent)",
};

function ToggleButton({
  label,
  active,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  Icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      style={{
        ...iconButtonStyle,
        background: active ? "rgba(255,255,255,0.16)" : "transparent",
      }}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  Icon,
}: {
  label: keyof Pick<ImageAdjustments, "brightness" | "contrast" | "saturation" | "sharpness">;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  Icon: LucideIcon;
}) {
  const displayLabel = label[0].toUpperCase() + label.slice(1);

  return (
    <div style={rowStyle}>
      <Icon size={16} aria-hidden="true" />
      <input
        type="range"
        aria-label={displayLabel}
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={rangeStyle}
      />
      <span aria-hidden="true" style={{ fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

export function ImageAdjustmentsPanel({
  panelRef,
  style,
}: {
  panelRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}) {
  const adjustments = useOverlay((s) => s.imageAdjustments);
  const setImageAdjustments = useOverlay((s) => s.setImageAdjustments);
  const resetImageAdjustments = useOverlay((s) => s.resetImageAdjustments);

  return (
    <div
      ref={panelRef}
      data-testid="image-adjustments-panel"
      data-image-adjustments-panel
      onMouseDown={(event) => event.stopPropagation()}
      style={{ ...panelStyle, ...style }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <ToggleButton
          label="Grayscale"
          active={adjustments.grayscale}
          Icon={Droplets}
          onClick={() => setImageAdjustments({ grayscale: !adjustments.grayscale })}
        />
        <ToggleButton
          label="Auto enhance"
          active={adjustments.autoLevels}
          Icon={Sparkles}
          onClick={() => setImageAdjustments({ autoLevels: !adjustments.autoLevels })}
        />
        <button
          type="button"
          aria-label="Reset image adjustments"
          title="Reset image adjustments"
          onClick={resetImageAdjustments}
          style={{ ...iconButtonStyle, marginLeft: "auto", background: "transparent" }}
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </div>

      <SliderRow
        label="brightness"
        value={adjustments.brightness}
        min={-100}
        max={100}
        Icon={SunMedium}
        onChange={(brightness) => setImageAdjustments({ brightness })}
      />
      <SliderRow
        label="contrast"
        value={adjustments.contrast}
        min={-100}
        max={100}
        Icon={Contrast}
        onChange={(contrast) => setImageAdjustments({ contrast })}
      />
      <SliderRow
        label="saturation"
        value={adjustments.saturation}
        min={-100}
        max={100}
        Icon={Droplets}
        onChange={(saturation) => setImageAdjustments({ saturation })}
      />
      <SliderRow
        label="sharpness"
        value={adjustments.sharpness}
        min={0}
        max={100}
        Icon={Sparkles}
        onChange={(sharpness) => setImageAdjustments({ sharpness })}
      />
    </div>
  );
}

