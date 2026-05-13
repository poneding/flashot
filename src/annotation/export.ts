import { getStage, getTransformer } from "@/annotation/Stage";

export async function exportAnnotationLayer(scaleFactor: number): Promise<ArrayBuffer | null> {
  const stage = getStage();
  if (!stage) return null;

  // Hide transformer before export
  const transformer = getTransformer();
  const wasVisible = transformer?.visible() ?? false;
  transformer?.visible(false);
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
  stage.batchDraw();

  if (!blob) return null;
  return blob.arrayBuffer();
}
