import { ImageAdjustmentsFilter } from "@/overlay/ImageAdjustmentsFilter";
import { useReleasableFrameSource } from "@/lib/frame-source";
import { captureOverlayReady } from "@/lib/ipc";
import {
  PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID,
  frozenLayerFilterForImageAdjustments,
  normalizeImageAdjustments,
} from "@/overlay/imageAdjustments";
import { useOverlay } from "@/overlay/state";

export function FrozenLayer() {
  const url = useOverlay((s) => s.frameUrl);
  const frameRevision = useOverlay((s) => s.frameRevision);
  const monitorId = useOverlay((s) => s.monitorId);
  const sessionMode = useOverlay((s) => s.sessionMode);
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
        onLoad={() => {
          if (sessionMode !== "capture" || !frameRevision || monitorId == null) return;
          captureOverlayReady(frameRevision, monitorId).catch(() => {
            /* the backend timeout still reveals the capture */
          });
        }}
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
            <ImageAdjustmentsFilter
              id={PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID}
              adjustments={normalized}
              width={previewWidth}
              height={previewHeight}
            />
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
