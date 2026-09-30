import { createContext, useContext } from "react";
import { useAnnotation } from "@/annotation/store";

/** The editor stays in its image window; a floating palette can supply these controls. */
export type AnnotationControls = Pick<ReturnType<typeof useAnnotation.getState>,
  | "activeTool" | "activeStyle" | "objects" | "selectedObjectId"
  | "currentMarkerNumber" | "canUndo" | "canRedo" | "setActiveTool"
  | "updateSelectedStyle" | "resizeObject" | "setCurrentMarkerNumber" | "undo" | "redo"
>;

export const AnnotationControlsContext = createContext<AnnotationControls | null>(null);

export function useAnnotationControls<T>(selector: (state: AnnotationControls) => T): T {
  const remote = useContext(AnnotationControlsContext);
  const local = useAnnotation(selector);
  return remote ? selector(remote) : local;
}
