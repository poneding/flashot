import { useAnnotation } from "@/annotation/store";
import {
  PRESET_COLORS,
  type AnnotationStyle,
  type ToolType,
} from "@/annotation/types";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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

function GradientPicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
}) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
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

  const hueColor = hsvToHex(hsv[0], 100, 100);

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
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
          width: 160,
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
          left: `${(hsv[0] / 360) * 100}%`,
          top: "50%",
          width: 10,
          height: 10,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 2px rgba(0,0,0,0.6)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }} />
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
  const isPreset = PRESET_COLORS.some((c) => c.toLowerCase() === value.toLowerCase());

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
      <div style={{ position: "relative" }}>
        <button
          title="Custom color"
          onClick={() => setShowGradient((v) => !v)}
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
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  const stepperBtn: CSSProperties = {
    ...btnBase,
    width: 20,
    height: 20,
    fontSize: 14,
    fontWeight: "bold",
    padding: 0,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <button
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
        style={stepperBtn}
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

// ─── DropdownSelect ──────────────────────────────────────────────────────────

type DropdownOption<T extends string> = { value: T; label: string; icon?: string };

function DropdownSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: DropdownOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
      const dropdownHeight = options.length * 28 + 8;
      setFlipUp(rect.bottom + dropdownHeight + 8 > window.innerHeight);
    }
    setOpen(!open);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        style={{ ...btnBase, gap: 4 }}
        onClick={handleOpen}
      >
        <span style={{ color: "#fff" }}>{selected?.icon ?? selected?.label ?? value}</span>
        <span style={{ fontSize: 8, opacity: 0.6 }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            ...(flipUp
              ? { bottom: "calc(100% + 4px)" }
              : { top: "calc(100% + 4px)" }),
            left: 0,
            minWidth: 80,
            background: "rgba(30, 30, 30, 0.95)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6,
            padding: "4px 0",
            zIndex: 10010,
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "5px 10px",
                border: "none",
                background: opt.value === value ? "rgba(255,255,255,0.1)" : "transparent",
                color: "#fff",
                fontSize: 12,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {opt.icon && <span>{opt.icon}</span>}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ToggleGroup ──────────────────────────────────────────────────────────────

type ToggleOption<T extends string> = { value: T; label: string; title?: string };

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
        <button
          key={opt.value}
          title={opt.title ?? opt.label}
          onClick={() => onChange(opt.value)}
          style={value === opt.value ? btnActive : btnBase}
        >
          {opt.label}
        </button>
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <DropdownSelect
        options={[
          { value: "solid", label: "Solid", icon: "━" },
          { value: "wavy", label: "Wavy", icon: "∿" },
          { value: "dotted", label: "Dotted", icon: "┈" },
          { value: "dashed", label: "Dashed", icon: "╌" },
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <DropdownSelect
        options={[
          { value: "solid", label: "Solid", icon: "━" },
          { value: "dotted", label: "Dotted", icon: "┈" },
          { value: "dashed", label: "Dashed", icon: "╌" },
        ]}
        value={style.lineStyle ?? "solid"}
        onChange={(lineStyle) => set({ lineStyle })}
      />
      <Separator />
      <DropdownSelect
        options={[
          { value: "v-shape", label: "Open", icon: ">" },
          { value: "filled-triangle", label: "Filled", icon: "▶" },
          { value: "pointed", label: "Pointed", icon: "▷" },
        ]}
        value={style.arrowStyle ?? "v-shape"}
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "hollow", label: "□", title: "Hollow" },
          { value: "solid", label: "■", title: "Filled" },
        ]}
        value={style.fill ?? "hollow"}
        onChange={(fill) => set({ fill })}
      />
      <ToggleGroup
        options={[
          { value: "0", label: "┐", title: "Sharp corners" },
          { value: "8", label: "╮", title: "Rounded corners" },
        ]}
        value={String(style.cornerRadius ?? 0)}
        onChange={(v) => set({ cornerRadius: Number(v) })}
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "hollow", label: "□", title: "Hollow" },
          { value: "solid", label: "■", title: "Filled" },
        ]}
        value={style.fill ?? "hollow"}
        onChange={(fill) => set({ fill })}
      />
    </>
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
      <DropdownSelect
        options={[
          { value: "Excalifont", label: "Handwriting", icon: "✎" },
          { value: "sans-serif", label: "Sans-serif", icon: "A" },
          { value: "serif", label: "Serif", icon: "T" },
          { value: "monospace", label: "Monospace", icon: "<>" },
        ]}
        value={style.fontFamily ?? "Excalifont"}
        onChange={(fontFamily) => set({ fontFamily })}
      />
      <Separator />
      <NumberStepper value={style.fontSize ?? 24} onChange={(fontSize) => set({ fontSize })} min={10} max={72} step={2} />
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
  return (
    <>
      <DropdownSelect
        options={[
          { value: "mosaic", label: "Mosaic", icon: "▦" },
          { value: "gaussian", label: "Gaussian", icon: "◌" },
        ]}
        value={style.blurMode ?? "mosaic"}
        onChange={(blurMode) => set({ blurMode })}
      />
      <Separator />
      <ToggleGroup
        options={[
          { value: "rect", label: "□", title: "Rectangle" },
          { value: "freehand", label: "✎", title: "Freehand" },
        ]}
        value={style.blurMethod ?? "rect"}
        onChange={(blurMethod) => set({ blurMethod })}
      />
      <Separator />
      <NumberStepper value={style.blurIntensity ?? 10} onChange={(blurIntensity) => set({ blurIntensity })} min={3} max={30} step={1} suffix="" />
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
      <NumberStepper value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} min={1} max={20} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "freehand", label: "✎", title: "Freehand highlight" },
          { value: "straight", label: "—", title: "Straight highlight" },
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
};

export function PropertyPanel({ tool, style: containerStyle }: Props) {
  const activeStyle = useAnnotation((s) => s.activeStyle);
  const setActiveStyle = useAnnotation((s) => s.setActiveStyle);

  if (tool === "select") return null;

  return (
    <div style={{ ...panelStyle, ...containerStyle }} onMouseDown={(e) => e.stopPropagation()}>
      {tool === "draw" && <PenSection style={activeStyle} set={setActiveStyle} />}
      {tool === "line" && <LineSection style={activeStyle} set={setActiveStyle} />}
      {tool === "arrow" && <ArrowSection style={activeStyle} set={setActiveStyle} />}
      {tool === "rect" && <RectSection style={activeStyle} set={setActiveStyle} />}
      {tool === "ellipse" && <EllipseSection style={activeStyle} set={setActiveStyle} />}
      {tool === "text" && <TextSection style={activeStyle} set={setActiveStyle} />}
      {tool === "blur" && <BlurSection style={activeStyle} set={setActiveStyle} />}
      {tool === "highlight" && <HighlightSection style={activeStyle} set={setActiveStyle} />}
    </div>
  );
}
