import { useAnnotation } from "@/annotation/store";
import { TooltipBubble } from "@/annotation/Tooltip";
import { HANDWRITING_FONT_VALUE, getSystemFonts, normalizeTextFontFamilyValue } from "@/annotation/fonts";
import {
  PRESET_COLORS,
  type AnnotationObject,
  type AnnotationStyle,
  type ToolType,
} from "@/annotation/types";
import {
  ChevronDown,
  Circle,
  Minus,
  PencilLine,
  Square,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";

// ─── Shared styles ────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 8,
  background: "rgba(30, 30, 30, 0.85)",
  backdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.8)",
  fontSize: 12,
  userSelect: "none",
};

const btnBase: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.6)",
  cursor: "pointer",
  borderRadius: 5,
  padding: "3px 6px",
  fontSize: 12,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const btnActive: CSSProperties = {
  ...btnBase,
  color: "rgba(255,255,255,1)",
  background: "rgba(255,255,255,0.15)",
};

// ─── Separator ────────────────────────────────────────────────────────────────

function Separator() {
  return (
    <div
      style={{
        width: 1,
        height: 18,
        background: "rgba(255,255,255,0.15)",
        flexShrink: 0,
        margin: "0 2px",
      }}
    />
  );
}

// ─── Color utilities ─────────────────────────────────────────────────────────

function parseColorInput(input: string): string | null {
  const trimmed = input.trim();

  // HEX format: #RGB or #RRGGBB
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    // Convert #RGB to #RRGGBB
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // RGB format: rgb(r, g, b) or r, g, b
  const rgbMatch = trimmed.match(/^(?:rgb\()?(\d+),\s*(\d+),\s*(\d+)\)?$/i);
  if (rgbMatch) {
    const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  return null;
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, v * 100];
}

function hsvToHex(h: number, s: number, v: number): string {
  h = h / 360; s = s / 100; v = v / 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─── GradientPicker ──────────────────────────────────────────────────────────

const GRADIENT_PICKER_GAP = 6;
const GRADIENT_PICKER_HEIGHT = 196;
const HUE_TRACK_WIDTH = 160;
const HUE_THUMB_SIZE = 10;

function GradientPicker({
  value,
  onChange,
  onClose,
  flipUp,
}: {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
  flipUp: boolean;
}) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  const [colorInput, setColorInput] = useState("");
  const [inputError, setInputError] = useState(false);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  useEffect(() => {
    // Update HSV when value changes externally
    setHsv(hexToHsv(value));
  }, [value]);

  const pickFromSquare = (e: MouseEvent | React.MouseEvent) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const v = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100));
    const next: [number, number, number] = [hsv[0], s, v];
    setHsv(next);
    onChange(hsvToHex(next[0], next[1], next[2]));
  };

  const pickFromHue = (e: MouseEvent | React.MouseEvent) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / rect.width) * 360));
    const next: [number, number, number] = [h, hsv[1], hsv[2]];
    setHsv(next);
    onChange(hsvToHex(next[0], next[1], next[2]));
  };

  const startDrag = (pickFn: (e: MouseEvent) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    pickFn(e.nativeEvent);
    const onMove = (ev: MouseEvent) => pickFn(ev);
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleColorInput = (input: string) => {
    setColorInput(input);
    if (!input) {
      setInputError(false);
      return;
    }
    const parsed = parseColorInput(input);
    if (parsed) {
      setInputError(false);
      setHsv(hexToHsv(parsed));
      onChange(parsed);
    } else {
      setInputError(true);
    }
  };

  const hueColor = hsvToHex(hsv[0], 100, 100);
  const hueThumbLeft = HUE_THUMB_SIZE / 2 + (hsv[0] / 360) * (HUE_TRACK_WIDTH - HUE_THUMB_SIZE);

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...(flipUp
          ? { bottom: `calc(100% + ${GRADIENT_PICKER_GAP}px)` }
          : { top: `calc(100% + ${GRADIENT_PICKER_GAP}px)` }),
        left: 0,
        padding: 8,
        borderRadius: 8,
        background: "rgba(30, 30, 30, 0.95)",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        zIndex: 10010,
      }}
    >
      {/* SV square */}
      <div
        ref={squareRef}
        onMouseDown={startDrag(pickFromSquare)}
        style={{
          width: 160,
          height: 160,
          borderRadius: 4,
          position: "relative",
          cursor: "crosshair",
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
      >
        <div style={{
          position: "absolute",
          left: `${hsv[1]}%`,
          top: `${100 - hsv[2]}%`,
          width: 10,
          height: 10,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxSizing: "border-box",
          boxShadow: "0 0 2px rgba(0,0,0,0.6)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }} />
      </div>
      {/* Hue bar */}
      <div
        ref={hueRef}
        onMouseDown={startDrag(pickFromHue)}
        style={{
          width: HUE_TRACK_WIDTH,
          height: 12,
          marginTop: 8,
          borderRadius: 6,
          cursor: "pointer",
          position: "relative",
          background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
      >
        <div style={{
          position: "absolute",
          left: `${hueThumbLeft}px`,
          top: "50%",
          width: HUE_THUMB_SIZE,
          height: HUE_THUMB_SIZE,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxSizing: "border-box",
          boxShadow: "0 0 2px rgba(0,0,0,0.6)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }} />
      </div>
      {/* Color input */}
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        <input
          type="text"
          placeholder="HEX or RGB"
          value={colorInput}
          onChange={(e) => handleColorInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
            }
          }}
          style={{
            width: "100%",
            padding: "4px 6px",
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${inputError ? "rgba(255,100,100,0.5)" : "rgba(255,255,255,0.2)"}`,
            borderRadius: 4,
            color: "#fff",
            fontSize: 11,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 4, fontSize: 10, color: "rgba(255,255,255,0.5)" }}>
          <span>HEX: {value.toUpperCase()}</span>
          <span>RGB: {hexToRgb(value)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── ColorPicker ──────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const [showGradient, setShowGradient] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const customColorRef = useRef<HTMLDivElement>(null);
  const isPreset = PRESET_COLORS.some((c) => c.toLowerCase() === value.toLowerCase());
  const updatePickerPlacement = () => {
    const rect = customColorRef.current?.getBoundingClientRect();
    if (!rect) {
      setFlipUp(false);
      return;
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    setFlipUp(spaceBelow < GRADIENT_PICKER_HEIGHT + GRADIENT_PICKER_GAP && spaceAbove > spaceBelow);
  };

  const toggleGradient = () => {
    if (!showGradient) updatePickerPlacement();
    setShowGradient((v) => !v);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          title={c}
          onClick={() => onChange(c)}
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: c,
            border:
              value.toLowerCase() === c.toLowerCase()
                ? "2px solid #fff"
                : "2px solid transparent",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            outline: "none",
          }}
        />
      ))}
      <div ref={customColorRef} style={{ position: "relative" }}>
        <button
          title="Custom color"
          onClick={toggleGradient}
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            background: isPreset
              ? "conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
              : value,
            border: showGradient || !isPreset
              ? "2px solid #fff"
              : "2px solid #888",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            outline: "none",
          }}
        />
        {showGradient && (
          <GradientPicker
            value={value}
            onChange={onChange}
            onClose={() => setShowGradient(false)}
            flipUp={flipUp}
          />
        )}
      </div>
    </div>
  );
}

// ─── NumberStepper ────────────────────────────────────────────────────────────

function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "px",
  title,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  title?: string;
  label?: string;
}) {
  const tooltip = title ?? label;
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const stepperRef = useRef<HTMLDivElement>(null);
  const stepperBtn: CSSProperties = {
    ...btnBase,
    width: 20,
    height: 20,
    fontSize: 14,
    fontWeight: "bold",
    padding: 0,
  };

  return (
    <div
      ref={stepperRef}
      title={tooltip}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 2 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button
          title={tooltip ? `Decrease ${tooltip}` : "Decrease"}
          style={stepperBtn}
          onClick={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
        >
          −
        </button>
        <span style={{ minWidth: 32, textAlign: "center", fontSize: 11, color: "#fff" }}>
          {value}{suffix}
        </span>
        <button
          title={tooltip ? `Increase ${tooltip}` : "Increase"}
          style={stepperBtn}
          onClick={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
      {tooltipVisible && tooltip && <TooltipBubble label={tooltip} anchorRef={stepperRef} />}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PanelIcon(Icon: LucideIcon): ReactNode {
  return <Icon size={16} strokeWidth={2} />;
}

function CustomIcon({
  children,
  lineStyleIcon,
}: {
  children: ReactNode;
  lineStyleIcon?: string;
}) {
  return (
    <svg
      data-line-style-icon={lineStyleIcon}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const lineStylePaths = {
  solid: ["M3 12h18"],
  dashed: ["M3 12h4", "M10 12h4", "M17 12h4"],
  wavy: ["M3 12c2.25-4 4.25-4 6.5 0s4.25 4 6.5 0 4.25-4 6.5 0"],
} as const;

type LineStyleIconVariant = "solid" | "dotted" | "dashed" | "wavy";

function LineStyleIcon({ variant }: { variant: LineStyleIconVariant }) {
  if (variant === "dotted") {
    return (
      <svg
        data-line-style-icon="dotted"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="none"
        aria-hidden="true"
      >
        <circle cx="6" cy="12" r="1.5" fill="currentColor" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12" r="1.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <CustomIcon lineStyleIcon={variant}>
      {lineStylePaths[variant].map((d) => (
        <path key={d} d={d} />
      ))}
    </CustomIcon>
  );
}

function OpenArrowIcon() {
  return (
    <CustomIcon>
      <path d="M4 12h14" />
      <path d="m14 7 5 5-5 5" />
    </CustomIcon>
  );
}

function FilledArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M4 12h9" />
      <path d="M12 9 20 12l-8 3Z" fill="currentColor" stroke="currentColor" />
    </svg>
  );
}

function FilledSquareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" />
    </svg>
  );
}

function FilledCircleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" />
    </svg>
  );
}

function MosaicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="9" height="9" fill="currentColor" />
      <rect x="12" y="3" width="9" height="9" fill="currentColor" opacity="0.3" />
      <rect x="3" y="12" width="9" height="9" fill="currentColor" opacity="0.3" />
      <rect x="12" y="12" width="9" height="9" fill="currentColor" />
    </svg>
  );
}

function GaussianIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <defs>
        <filter id="blur-icon-filter">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
        </filter>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="5" y="5" width="14" height="14" fill="currentColor" filter="url(#blur-icon-filter)" />
    </svg>
  );
}

function SolidIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" fill="currentColor" />
    </svg>
  );
}

// ─── DropdownSelect ──────────────────────────────────────────────────────────

type DropdownOption<T extends string> = { value: T; label: string; icon: ReactNode };

function DropdownOptionButton<T extends string>({
  option,
  selected,
  onSelect,
}: {
  option: DropdownOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
}) {
  const optionRef = useRef<HTMLButtonElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <>
      <button
        ref={optionRef}
        type="button"
        aria-label={option.label}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onClick={() => onSelect(option.value)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          padding: 0,
          border: "none",
          borderRadius: 5,
          background: selected ? "rgba(255,255,255,0.1)" : "transparent",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {option.icon}
        </span>
      </button>
      {tooltipVisible && <TooltipBubble label={option.label} anchorRef={optionRef} placement="right" />}
    </>
  );
}

function DropdownSelect<T extends string>({
  options,
  value,
  onChange,
  title,
}: {
  options: DropdownOption<T>[];
  value: T;
  onChange: (v: T) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const handleOpen = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const dropdownHeight = options.length * 30 + 8;
      setFlipUp(rect.bottom + dropdownHeight + 8 > window.innerHeight);
    }
    setOpen(!open);
  };

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected?.label ?? value;
  const selectedTitle = title ? `${title}: ${selectedLabel}` : selectedLabel;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={selectedTitle}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        style={{ ...btnBase, gap: 4 }}
        onClick={handleOpen}
      >
        <span style={{ color: "#fff", display: "flex", alignItems: "center" }}>
          {selected?.icon ?? selected?.label ?? value}
        </span>
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>
      {tooltipVisible && <TooltipBubble label={selectedTitle} anchorRef={triggerRef} />}
      {open && (
        <div
          style={{
            position: "absolute",
            ...(flipUp
              ? { bottom: "calc(100% + 4px)" }
              : { top: "calc(100% + 4px)" }),
            left: 0,
            minWidth: 36,
            background: "rgba(30, 30, 30, 0.95)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: 4,
            display: "grid",
            gap: 2,
            justifyItems: "center",
            zIndex: 10010,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {options.map((opt) => (
            <DropdownOptionButton
              key={opt.value}
              option={opt}
              selected={opt.value === value}
              onSelect={(nextValue) => {
                onChange(nextValue);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ToggleGroup ──────────────────────────────────────────────────────────────

type ToggleOption<T extends string> = { value: T; label: ReactNode; title: string };

function ToggleButton<T extends string>({
  option,
  selected,
  onSelect,
}: {
  option: ToggleOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={option.title}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onClick={() => onSelect(option.value)}
        style={selected ? btnActive : btnBase}
      >
        {option.label}
      </button>
      {tooltipVisible && <TooltipBubble label={option.title} anchorRef={btnRef} />}
    </>
  );
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ToggleOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {options.map((opt) => (
        <ToggleButton
          key={opt.value}
          option={opt}
          selected={value === opt.value}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}

// ─── Tool sections ────────────────────────────────────────────────────────────

function PenSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
    </>
  );
}

function LineSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <DropdownSelect
        title="Line style"
        options={[
          { value: "solid", label: "Solid", icon: <LineStyleIcon variant="solid" /> },
          { value: "wavy", label: "Wavy", icon: <LineStyleIcon variant="wavy" /> },
          { value: "dotted", label: "Dotted", icon: <LineStyleIcon variant="dotted" /> },
          { value: "dashed", label: "Dashed", icon: <LineStyleIcon variant="dashed" /> },
        ]}
        value={(() => {
          if (style.lineShape === "wavy") return "wavy";
          return style.lineStyle ?? "solid";
        })()}
        onChange={(v) => {
          if (v === "wavy") set({ lineShape: "wavy", lineStyle: "solid" });
          else set({ lineShape: "straight", lineStyle: v as "solid" | "dotted" | "dashed" });
        }}
      />
    </>
  );
}

function ArrowSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <DropdownSelect
        title="Line style"
        options={[
          { value: "solid", label: "Solid", icon: <LineStyleIcon variant="solid" /> },
          { value: "dotted", label: "Dotted", icon: <LineStyleIcon variant="dotted" /> },
          { value: "dashed", label: "Dashed", icon: <LineStyleIcon variant="dashed" /> },
        ]}
        value={style.lineStyle ?? "solid"}
        onChange={(lineStyle) => set({ lineStyle })}
      />
      <Separator />
      <DropdownSelect
        title="Arrowhead"
        options={[
          { value: "v-shape", label: "Open", icon: <OpenArrowIcon /> },
          { value: "filled-triangle", label: "Filled", icon: <FilledArrowIcon /> },
        ]}
        value={style.arrowStyle === "filled-triangle" ? "filled-triangle" : "v-shape"}
        onChange={(arrowStyle) => set({ arrowStyle })}
      />
    </>
  );
}

function RectSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "hollow", label: PanelIcon(Square), title: "Hollow" },
          { value: "solid", label: <FilledSquareIcon />, title: "Filled" },
        ]}
        value={style.fill ?? "hollow"}
        onChange={(fill) => set({ fill })}
      />
      <Separator />
      <NumberStepper
        label="Radius"
        title="Corner radius"
        value={style.cornerRadius ?? 0}
        onChange={(cornerRadius) => set({ cornerRadius })}
        min={0}
        max={48}
      />
    </>
  );
}

function EllipseSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "hollow", label: PanelIcon(Circle), title: "Hollow" },
          { value: "solid", label: <FilledCircleIcon />, title: "Filled" },
        ]}
        value={style.fill ?? "hollow"}
        onChange={(fill) => set({ fill })}
      />
    </>
  );
}

function FontFamilySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  useEffect(() => {
    getSystemFonts().then(setFonts);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [open]);

  const handleOpen = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setFlipUp(rect.bottom + 208 > window.innerHeight);
    }
    setOpen(!open);
    if (!open) {
      setSearchQuery("");
    }
  };

  const allOptions = [
    { value: HANDWRITING_FONT_VALUE, label: "Handwriting" },
    ...fonts.map((f) => ({ value: f, label: f })),
  ];

  const filteredOptions = searchQuery
    ? allOptions.filter((opt) =>
        opt.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allOptions;

  const selectedLabel = allOptions.find((o) => o.value === value)?.label ?? value;
  const title = `Font: ${selectedLabel}`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={title}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        style={{ ...btnBase, gap: 4 }}
        onClick={handleOpen}
      >
        <span style={{ color: "#fff", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
          {selectedLabel}
        </span>
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>
      {tooltipVisible && !open && <TooltipBubble label={title} anchorRef={triggerRef} />}
      {open && (
        <div
          style={{
            position: "absolute",
            ...(flipUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
            left: 0,
            minWidth: 140,
            background: "rgba(30, 30, 30, 0.95)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: 4,
            zIndex: 10010,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search fonts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filteredOptions.length > 0) {
                onChange(filteredOptions[0].value);
                setOpen(false);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            style={{
              width: "100%",
              padding: "4px 8px",
              marginBottom: 4,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 4,
              color: "#fff",
              fontSize: 11,
              outline: "none",
            }}
          />
          <div
            style={{
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {filteredOptions.length === 0 ? (
              <div style={{ padding: "8px", color: "rgba(255,255,255,0.5)", fontSize: 11, textAlign: "center" }}>
                No fonts found
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  style={{
                    ...btnBase,
                    width: "100%",
                    textAlign: "left" as const,
                    justifyContent: "flex-start",
                    padding: "4px 8px",
                    whiteSpace: "nowrap",
                    ...(opt.value === value ? { background: "rgba(255,255,255,0.15)", color: "#fff" } : {}),
                  }}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TextSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <FontFamilySelect
        value={normalizeTextFontFamilyValue(style.fontFamily)}
        onChange={(fontFamily) => set({ fontFamily })}
      />
      <Separator />
      <NumberStepper label="Size" title="Font size" value={style.fontSize ?? 24} onChange={(fontSize) => set({ fontSize })} min={10} max={72} step={2} />
    </>
  );
}

function BlurSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  const mode = style.blurMode ?? "mosaic";
  const showIntensity = mode === "mosaic" || mode === "gaussian";
  const showColorPicker = mode === "solid";

  return (
    <>
      <ToggleGroup
        options={[
          { value: "mosaic", label: <MosaicIcon />, title: "Mosaic" },
          { value: "gaussian", label: <GaussianIcon />, title: "Gaussian Blur" },
          { value: "solid", label: <SolidIcon />, title: "Solid Color" },
        ]}
        value={mode}
        onChange={(blurMode) => set({ blurMode })}
      />
      {showColorPicker && (
        <>
          <Separator />
          <ColorPicker value={style.blurSolidColor ?? "#000000"} onChange={(blurSolidColor) => set({ blurSolidColor })} />
        </>
      )}
      {showIntensity && (
        <>
          <Separator />
          <NumberStepper label="Strength" title="Blur intensity" value={style.blurIntensity ?? 10} onChange={(blurIntensity) => set({ blurIntensity })} min={3} max={30} step={1} suffix="" />
        </>
      )}
    </>
  );
}

function HighlightSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <>
      <ColorPicker value={style.color} onChange={(color) => set({ color })} />
      <Separator />
      <NumberStepper label="Stroke" title="Stroke width" value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "freehand", label: PanelIcon(PencilLine), title: "Freehand highlight" },
          { value: "straight", label: PanelIcon(Minus), title: "Straight highlight" },
        ]}
        value={style.highlightMode ?? "freehand"}
        onChange={(highlightMode) => set({ highlightMode })}
      />
    </>
  );
}

// ─── PropertyPanel ────────────────────────────────────────────────────────────

type Props = {
  tool: ToolType;
  style?: CSSProperties;
  object?: AnnotationObject;
  panelRef?: Ref<HTMLDivElement>;
};

export function PropertyPanel({ tool, style: containerStyle, object, panelRef }: Props) {
  const activeStyle = useAnnotation((s) => s.activeStyle);
  const setActiveStyle = useAnnotation((s) => s.setActiveStyle);
  const modifyStyle = useAnnotation((s) => s.modifyStyle);
  const style = object?.style ?? activeStyle;
  const set = (partial: Partial<AnnotationStyle>) => {
    if (object) {
      modifyStyle(object.id, partial);
      return;
    }
    setActiveStyle(partial);
  };

  if (tool === "select") return null;

  return (
    <div
      ref={panelRef}
      data-annotation-property-panel
      style={{ ...panelStyle, ...containerStyle }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {tool === "draw" && <PenSection style={style} set={set} />}
      {tool === "line" && <LineSection style={style} set={set} />}
      {tool === "arrow" && <ArrowSection style={style} set={set} />}
      {tool === "rect" && <RectSection style={style} set={set} />}
      {tool === "ellipse" && <EllipseSection style={style} set={set} />}
      {tool === "text" && <TextSection style={style} set={set} />}
      {tool === "blur" && <BlurSection style={style} set={set} />}
      {tool === "highlight" && <HighlightSection style={style} set={set} />}
    </div>
  );
}
