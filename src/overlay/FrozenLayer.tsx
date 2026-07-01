import { useReleasableFrameSource } from "@/lib/frame-source";
import {
  PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID,
  frozenLayerFilterForImageAdjustments,
  normalizeImageAdjustments,
} from "@/overlay/imageAdjustments";
import { useOverlay } from "@/overlay/state";

function formatFilterNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function channelTransfer(slope: number, intercept: number) {
  const formattedSlope = formatFilterNumber(slope);
  const formattedIntercept = formatFilterNumber(intercept);

  return (
    <feComponentTransfer>
      <feFuncR type="linear" slope={formattedSlope} intercept={formattedIntercept} />
      <feFuncG type="linear" slope={formattedSlope} intercept={formattedIntercept} />
      <feFuncB type="linear" slope={formattedSlope} intercept={formattedIntercept} />
    </feComponentTransfer>
  );
}

function grayscaleMatrix(): string {
  return [
    0.299, 0.587, 0.114, 0, 0,
    0.299, 0.587, 0.114, 0, 0,
    0.299, 0.587, 0.114, 0, 0,
    0, 0, 0, 1, 0,
  ].map(formatFilterNumber).join(" ");
}

function saturationMatrix(factor: number): string {
  const inverse = 1 - factor;
  const lr = 0.299;
  const lg = 0.587;
  const lb = 0.114;

  return [
    lr * inverse + factor, lg * inverse, lb * inverse, 0, 0,
    lr * inverse, lg * inverse + factor, lb * inverse, 0, 0,
    lr * inverse, lg * inverse, lb * inverse + factor, 0, 0,
    0, 0, 0, 1, 0,
  ].map(formatFilterNumber).join(" ");
}

export function FrozenLayer() {
  const url = useOverlay((s) => s.frameUrl);
  const mode = useOverlay((s) => s.mode);
  const imageAdjustments = useOverlay((s) => s.imageAdjustments);
  const monitorRect = useOverlay((s) => s.monitorRect);
  const selection = useOverlay((s) => s.selection);
  const hiddenForScroll = mode === "scrollStarting" || mode === "scrolling";
  const source = useReleasableFrameSource(url && !hiddenForScroll ? url : null);

  if (!url) return null;
  // In scrolling mode the user needs to see the live underlying app so they
  // can scroll it. Hide the frozen screenshot — the SelectionBox outline still
  // marks where the capture region is.
  if (hiddenForScroll) return null;
  if (!source) return null;

  const normalized = normalizeImageAdjustments(imageAdjustments);
  const showPreviewLayer = Boolean(
    normalized.grayscale ||
    normalized.brightness !== 0 ||
    normalized.contrast !== 0 ||
    normalized.saturation !== 0,
  );
  const previewFilter = showPreviewLayer ? frozenLayerFilterForImageAdjustments(normalized) : "none";
  const monitorWidth = monitorRect?.width ?? 1;
  const monitorHeight = monitorRect?.height ?? 1;
  const previewRect = selection ?? { x: 0, y: 0, width: monitorWidth, height: monitorHeight };
  const previewWidth = Math.max(1, previewRect.width);
  const previewHeight = Math.max(1, previewRect.height);

  return (
    <>
      <img
        src={source}
        alt=""
        data-frozen-layer
        crossOrigin="anonymous"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "fill",
          pointerEvents: "none",
          userSelect: "none",
          cursor: "inherit",
        }}
      />
      {showPreviewLayer && (
        <svg
          data-adjusted-frozen-layer
          aria-hidden="true"
          viewBox={`0 0 ${previewWidth} ${previewHeight}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            left: previewRect.x,
            top: previewRect.y,
            width: previewWidth,
            height: previewHeight,
            overflow: "hidden",
            pointerEvents: "none",
            userSelect: "none",
            cursor: "inherit",
          }}
        >
          <defs>
            <filter
              id={PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID}
              colorInterpolationFilters="sRGB"
              filterUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={previewWidth}
              height={previewHeight}
            >
              {normalized.grayscale && (
                <feColorMatrix type="matrix" values={grayscaleMatrix()} />
              )}
              {normalized.brightness !== 0 && channelTransfer(1, normalized.brightness / 100)}
              {normalized.contrast !== 0 &&
                channelTransfer(
                  1 + normalized.contrast / 100,
                  (128 / 255) * (1 - (1 + normalized.contrast / 100)),
                )}
              {normalized.saturation !== 0 && (
                <feColorMatrix
                  type="matrix"
                  values={saturationMatrix(1 + normalized.saturation / 100)}
                />
              )}
            </filter>
          </defs>
          <image
            href={source}
            x={-previewRect.x}
            y={-previewRect.y}
            width={monitorWidth}
            height={monitorHeight}
            preserveAspectRatio="none"
            filter={previewFilter}
          />
        </svg>
      )}
    </>
  );
}
