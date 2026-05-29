import type { Point } from "@/lib/types";

export type AnnotationId = string;

export type ToolType =
  | "select"
  | "draw"
  | "line"
  | "measure"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "blur"
  | "highlight"
  | "marker"
  | "magnifier"
  | "eraser";

export type LineShape = "straight" | "wavy";
export type LineStyle = "solid" | "dotted" | "dashed";
export type ArrowDirection = "none" | "start" | "end" | "both";
export type ArrowStyle = "v-shape" | "filled-triangle";
export type FillMode = "hollow" | "solid" | "spotlight";
export type BlurMode = "mosaic" | "gaussian" | "solid";
export type HighlightMode = "freehand" | "straight";
export type FocusMode = "none" | "spotlight";
export type MagnifierShape = "circle" | "rounded-rect";
export type MeasureMode = "free" | "axis";

export type AnnotationStyle = {
  color: string;
  strokeWidth: number;
  lineShape?: LineShape;
  lineStyle?: LineStyle;
  arrow?: ArrowDirection;
  arrowStyle?: ArrowStyle;
  fill?: FillMode;
  cornerRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  blurMode?: BlurMode;
  blurIntensity?: number;
  blurSolidColor?: string;
  highlightMode?: HighlightMode;
  opacity?: number;
  focusMode?: FocusMode;
  focusOpacity?: number;
  focusColor?: string;
  measureMode?: MeasureMode;
  markerFill?: string;
  markerTextColor?: string;
  markerBubbleFill?: string;
  magnifierShape?: MagnifierShape;
  magnifierZoom?: number;
  magnifierBorderColor?: string;
  magnifierBorderWidth?: number;
  magnifierCornerRadius?: number;
};

export type AnnotationObject = {
  id: AnnotationId;
  type: "draw" | "line" | "measure" | "arrow" | "rect" | "ellipse" | "text" | "blur" | "highlight" | "marker" | "magnifier";
  points?: number[];
  start?: Point;
  end?: Point;
  text?: string;
  markerNumber?: number;
  style: AnnotationStyle;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  };
};

export type CommandType = "add" | "delete" | "move" | "resize" | "modify-style";

export type Command = {
  type: CommandType;
  objectId: AnnotationId;
  before: Partial<AnnotationObject>;
  after: Partial<AnnotationObject>;
};

export const PRESET_COLORS = [
  "#ff0000",
  "#ff6600",
  "#ffcc00",
  "#33cc33",
  "#0099ff",
  "#6633ff",
  "#cc00cc",
  "#ffffff",
  "#999999",
  "#000000",
];

export const STROKE_WIDTHS = Array.from({ length: 20 }, (_, index) => index + 1);

export const FONT_SIZES = Array.from({ length: 72 }, (_, index) => index + 1);

export const DEFAULT_STYLE: AnnotationStyle = {
  color: "#ff0000",
  strokeWidth: 4,
  lineShape: "straight",
  lineStyle: "solid",
  arrow: "none",
  arrowStyle: "v-shape",
  fill: "hollow",
  cornerRadius: 0,
  fontFamily: "system-ui",
  fontSize: 24,
  blurMode: "mosaic",
  blurIntensity: 10,
  blurSolidColor: "#000000",
  highlightMode: "freehand",
  opacity: 0.35,
  measureMode: "free",
  markerFill: "#ff0000",
  magnifierShape: "circle",
  magnifierZoom: 2,
  magnifierBorderColor: "#9CA3AF",
  magnifierBorderWidth: 8,
  magnifierCornerRadius: 12,
};
