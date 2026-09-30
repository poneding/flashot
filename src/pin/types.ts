import type { AnnotationControls } from "@/annotation/controls";
import type { AnnotationObject, AnnotationStyle, ToolType } from "@/annotation/types";
import type { Locale } from "@/i18n";
import type { ImageAdjustments } from "@/lib/types";

export type PinToolKind = "controls" | "editor";
export type PinResizeDirection = "North" | "NorthEast" | "East" | "SouthEast" | "South" | "SouthWest" | "West" | "NorthWest";
export type PinAnnotationSnapshot = Pick<AnnotationControls,
  "activeTool" | "activeStyle" | "objects" | "selectedObjectId" | "currentMarkerNumber" | "canUndo" | "canRedo"
>;

export type PinToolsSnapshot = {
  visible: boolean;
  editing: boolean;
  scale: number;
  copyConfirmed: boolean;
  locale: Locale;
  imageAdjustments: ImageAdjustments;
  annotation: PinAnnotationSnapshot;
};

export type PinToolsEnvelope = { pinId: string; revision: number; state: PinToolsSnapshot };
export type PinToolLayout = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorWidth: number;
  anchorHeight: number;
};
export type PinToolPlacement = { side: "left" | "right" | "top" | "bottom" };

export type PinAction =
  | { type: "hover" | "focus"; kind: PinToolKind; visible: boolean }
  | { type: "edit" | "close" | "save" | "copy" | "undo" | "redo" | "reset-adjustments" }
  | { type: "scale"; scale: number }
  | { type: "tool"; tool: ToolType }
  | { type: "style"; updates: Partial<AnnotationStyle>; tool: ToolType; selectedObjectId: string | null }
  | { type: "resize-object"; id: string; updates: Partial<AnnotationObject> }
  | { type: "marker-number"; value: number }
  | { type: "adjustments"; updates: Partial<ImageAdjustments> };

export const PIN_ACTION_EVENT = "pin:action";
export const PIN_TOOLS_STATE_EVENT = "pin:tools-state";
export const PIN_TOOLS_PLACEMENT_EVENT = "pin:tools-placement";
