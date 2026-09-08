import type { ImageAdjustments } from "@/lib/types";
import { imageAdjustmentMatrix } from "@/overlay/imageAdjustments";

export function ImageAdjustmentsFilter({ id, adjustments, width, height }: {
  id: string;
  adjustments: ImageAdjustments;
  width?: number;
  height?: number;
}) {
  return (
    <filter
      id={id}
      colorInterpolationFilters="sRGB"
      filterUnits={width == null ? "objectBoundingBox" : "userSpaceOnUse"}
      x={width == null ? "-20%" : 0}
      y={height == null ? "-20%" : 0}
      width={width ?? "140%"}
      height={height ?? "140%"}
    >
      <feColorMatrix type="matrix" values={imageAdjustmentMatrix(adjustments).join(" ")} />
    </filter>
  );
}
