import { TooltipBubble } from "@/annotation/Tooltip";
import { createTranslator, type Locale } from "@/i18n";
import { useOverlay } from "@/overlay/state";
import {
  Blend,
  Contrast,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type CSSProperties, type Ref } from "react";

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

function SliderRow({
  displayLabel,
  value,
  min,
  max,
  onChange,
  Icon,
}: {
  displayLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  Icon: LucideIcon;
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      style={rowStyle}
    >
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
      {tooltipVisible && <TooltipBubble label={displayLabel} anchorRef={rowRef} placement="left" />}
    </div>
  );
}

export function ImageAdjustmentsPanel({
  panelRef,
  style,
  locale = "en",
}: {
  panelRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  locale?: Locale;
}) {
  const t = createTranslator(locale);
  const adjustments = useOverlay((s) => s.imageAdjustments);
  const setImageAdjustments = useOverlay((s) => s.setImageAdjustments);
  const resetImageAdjustments = useOverlay((s) => s.resetImageAdjustments);
  const [resetActive, setResetActive] = useState(false);

  return (
    <div
      ref={panelRef}
      data-testid="image-adjustments-panel"
      data-image-adjustments-panel
      onMouseDown={(event) => event.stopPropagation()}
      style={{ ...panelStyle, ...style }}
    >
      <SliderRow
        displayLabel={t("imageAdjustments.brightness")}
        value={adjustments.brightness}
        min={-100}
        max={100}
        Icon={Sun}
        onChange={(brightness) => setImageAdjustments({ brightness })}
      />
      <SliderRow
        displayLabel={t("imageAdjustments.contrast")}
        value={adjustments.contrast}
        min={-100}
        max={100}
        Icon={Contrast}
        onChange={(contrast) => setImageAdjustments({ contrast })}
      />
      <SliderRow
        displayLabel={t("imageAdjustments.saturation")}
        value={adjustments.saturation}
        min={-100}
        max={100}
        Icon={Blend}
        onChange={(saturation) => setImageAdjustments({ saturation })}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 4,
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "rgba(255,255,255,0.82)",
          }}
        >
          <input
            type="checkbox"
            checked={adjustments.grayscale}
            onChange={(event) => setImageAdjustments({ grayscale: event.currentTarget.checked })}
            style={{ accentColor: "var(--flashot-accent)" }}
          />
          <span>{t("imageAdjustments.grayscale")}</span>
        </label>
        <button
          type="button"
          onClick={resetImageAdjustments}
          onMouseEnter={() => setResetActive(true)}
          onMouseLeave={() => setResetActive(false)}
          onFocus={() => setResetActive(true)}
          onBlur={() => setResetActive(false)}
          style={{
            height: 24,
            padding: "0 6px",
            borderRadius: 6,
            border: "1px solid transparent",
            borderColor: resetActive ? "rgba(255,255,255,0.18)" : "transparent",
            background: resetActive ? "rgba(255,255,255,0.08)" : "transparent",
            color: "rgba(255,255,255,0.78)",
            fontSize: 12,
            cursor: "pointer",
            transition: "background 0.1s, border-color 0.1s",
          }}
        >
          {t("imageAdjustments.reset")}
        </button>
      </div>
    </div>
  );
}
