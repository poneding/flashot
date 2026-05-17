import { getStage, getTransformer } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";

const EDIT_OVERLAY_SELECTOR = ".annotation-edit-overlay";

export async function exportAnnotationLayer(scaleFactor: number): Promise<ArrayBuffer | null> {
  const stage = getStage();
  if (!stage) return null;
  if (useAnnotation.getState().objects.length === 0) return null;

  // Hide transformer before export
  const transformer = getTransformer();
  const wasVisible = transformer?.visible() ?? false;
  const editOverlays = stage.find(EDIT_OVERLAY_SELECTOR);
  const editOverlayVisibility = editOverlays.map((node) => node.visible());
  transformer?.visible(false);
  editOverlays.forEach((node) => node.visible(false));
  stage.batchDraw();

  const blob = await new Promise<Blob | null>((resolve) => {
    stage.toBlob({
      pixelRatio: scaleFactor,
      mimeType: "image/png",
      callback: (blob) => resolve(blob),
    });
  });

  // Restore transformer
  transformer?.visible(wasVisible);
  editOverlays.forEach((node, index) => node.visible(editOverlayVisibility[index] ?? true));
  stage.batchDraw();

  if (!blob) return null;
  return blob.arrayBuffer();
}
