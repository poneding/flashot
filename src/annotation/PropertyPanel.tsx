import type { CSSProperties } from "react";
import { useAnnotation } from "@/annotation/store";
import {
  PRESET_COLORS,
  STROKE_WIDTHS,
  FONT_SIZES,
  type ToolType,
  type AnnotationStyle,
} from "@/annotation/types";

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

// ─── ColorPicker ──────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
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
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Custom color"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.3)",
          cursor: "pointer",
          padding: 0,
          background: "transparent",
          outline: "none",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

// ─── StrokeWidthPicker ────────────────────────────────────────────────────────

function StrokeWidthPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (w: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          title={`${w}px`}
          onClick={() => onChange(w)}
          style={value === w ? btnActive : btnBase}
        >
          <div
            style={{
              width: 16,
              height: w,
              borderRadius: w / 2,
              background: value === w ? "#fff" : "rgba(255,255,255,0.6)",
            }}
          />
        </button>
      ))}
    </div>
  );
}

// ─── FontSizePicker ───────────────────────────────────────────────────────────

function FontSizePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (s: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {FONT_SIZES.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          style={value === s ? btnActive : btnBase}
        >
          {s}
        </button>
      ))}
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
      <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
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
      <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
      <Separator />
      <ToggleGroup
        options={[
          { value: "straight", label: "—", title: "Straight" },
          { value: "wavy", label: "∿", title: "Wavy" },
        ]}
        value={style.lineShape ?? "straight"}
        onChange={(lineShape) => set({ lineShape })}
      />
      <ToggleGroup
        options={[
          { value: "solid", label: "━", title: "Solid" },
          { value: "dotted", label: "┈", title: "Dotted" },
          { value: "dashed", label: "╌", title: "Dashed" },
        ]}
        value={style.lineStyle ?? "solid"}
        onChange={(lineStyle) => set({ lineStyle })}
      />
      <ToggleGroup
        options={[
          { value: "none", label: "○", title: "No arrow" },
          { value: "start", label: "←", title: "Arrow at start" },
          { value: "end", label: "→", title: "Arrow at end" },
          { value: "both", label: "↔", title: "Both ends" },
        ]}
        value={style.arrow ?? "none"}
        onChange={(arrow) => set({ arrow })}
      />
      <ToggleGroup
        options={[
          { value: "v-shape", label: ">", title: "V-shape arrow" },
          { value: "filled-triangle", label: "▶", title: "Filled triangle" },
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
      <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
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
          { value: 0, label: "┐", title: "Sharp corners" },
          { value: 8, label: "╮", title: "Rounded corners" },
        ] as unknown as ToggleOption<string>[]}
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
      <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
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
      <ToggleGroup
        options={[
          { value: "Excalifont", label: "Ex", title: "Excalifont" },
          { value: "sans-serif", label: "Aa", title: "Sans-serif" },
          { value: "serif", label: "Sf", title: "Serif" },
          { value: "monospace", label: "Mo", title: "Monospace" },
        ]}
        value={style.fontFamily ?? "Excalifont"}
        onChange={(fontFamily) => set({ fontFamily })}
      />
      <Separator />
      <FontSizePicker value={style.fontSize ?? 24} onChange={(fontSize) => set({ fontSize })} />
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
      <ToggleGroup
        options={[
          { value: "mosaic", label: "▦", title: "Mosaic blur" },
          { value: "gaussian", label: "◌", title: "Gaussian blur" },
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
      <ToggleGroup
        options={[
          { value: "5", label: "S", title: "Small" },
          { value: "10", label: "M", title: "Medium" },
          { value: "20", label: "L", title: "Large" },
        ]}
        value={String(style.blurIntensity ?? 10)}
        onChange={(v) => set({ blurIntensity: Number(v) })}
      />
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
      <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
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

function EraserSection({
  style,
  set,
}: {
  style: AnnotationStyle;
  set: (p: Partial<AnnotationStyle>) => void;
}) {
  return (
    <StrokeWidthPicker value={style.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
  );
}

// ─── PropertyPanel ────────────────────────────────────────────────────────────

type Props = {
  tool: ToolType;
  style?: CSSProperties;
};

export function PropertyPanel({ tool, style }: Props) {
  const activeStyle = useAnnotation((s) => s.activeStyle);
  const setActiveStyle = useAnnotation((s) => s.setActiveStyle);

  // Tools with no options
  if (tool === "select") return null;

  return (
    <div style={{ ...panelStyle, ...style }}>
      {tool === "draw" && (
        <PenSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "line" && (
        <LineSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "rect" && (
        <RectSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "ellipse" && (
        <EllipseSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "text" && (
        <TextSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "blur" && (
        <BlurSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "highlight" && (
        <HighlightSection style={activeStyle} set={setActiveStyle} />
      )}
      {tool === "eraser" && (
        <EraserSection style={activeStyle} set={setActiveStyle} />
      )}
    </div>
  );
}
