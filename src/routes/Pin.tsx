import { ImageAdjustmentsFilter } from "@/overlay/ImageAdjustmentsFilter";
import { useAnnotation } from "@/annotation/store";
import { createTranslator } from "@/i18n";
import { ACCENT_COLOR_CSS_VAR, ACCENT_RGB_CSS_VAR } from "@/lib/colors";
import { FLOATING_LABEL_BACKGROUND } from "@/lib/floating-surface";
import { closePin, copyPin, onPinAction, pinInteractionContainsCursor, savePin, setPinScale, updatePinAnnotation } from "@/lib/ipc";
import type { Rect } from "@/lib/types";
import { PinResizeHandles } from "@/pin/PinResizeHandles";
import { clampPinScale as clampScale, isPinTextInput as isTextInputLike, pinScaleLabel as scaleLabel, PIN_SCALE_STEP } from "@/pin/scale";
import type { PinAction } from "@/pin/types";
import { usePublishPinTools } from "@/pin/usePublishPinTools";
import { usePinDrag } from "@/pin/usePinDrag";
import { frozenLayerFilterForImageAdjustments, hasImageAdjustments, PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID } from "@/overlay/imageAdjustments";
import { useOverlay } from "@/overlay/state";
import { useStoredAccentColor, useStoredLanguage } from "@/settings/useStoredAccentColor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, lazy, useMemo, useRef, useState, Suspense, type CSSProperties } from "react";

// The annotation editor (Stage/Toolbar/export) transitively imports Konva
// (~870 KB). It is only needed in edit mode, so we load it lazily — this keeps
// Konva out of the pin window's startup bundle, so pinning a screenshot feels
// instant. The dynamic chunks load on demand the first time the user edits.
const AnnotationStage = lazy(() =>
  import("@/annotation/Stage").then((m) => ({ default: m.AnnotationStage })),
);
const PIN_WHEEL_NOTCH_DELTA = 100;
const PIN_WHEEL_LINE_DELTA = 16;
const PIN_WHEEL_PAGE_DELTA = 800;
const PIN_COPY_FEEDBACK_MS = 900;
const PIN_SCALE_BADGE_MS = 900;
const PIN_GLOW = [
  `inset 0 0 1px rgba(${ACCENT_RGB_CSS_VAR}, 0.6)`,
  `inset 0 0 6px rgba(${ACCENT_RGB_CSS_VAR}, 0.5)`,
].join(", ");

function visualAnnotationScale(exportScale: number, displayScale = 1): number {
  const deviceScale = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return Math.max(1, exportScale, deviceScale * displayScale);
}


function normalizedWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * PIN_WHEEL_LINE_DELTA;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * PIN_WHEEL_PAGE_DELTA;
  return event.deltaY;
}

function currentViewportSize() {
  return {
    width: Math.max(1, window.innerWidth || 1),
    height: Math.max(1, window.innerHeight || 1),
  };
}

function pinContentSelection(viewport: { width: number; height: number }): Rect {
  return {
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  };
}

function parsePinRoute(): { id: string; hasAnnotation: boolean; radius: number; width?: number; height?: number } | null {
  const h = window.location.hash || "";
  const prefix = "#/pin/";
  if (!h.startsWith(prefix)) return null;
  const rest = h.slice(prefix.length);
  const [idPart, queryPart = ""] = rest.split("?");
  // Strip any trailing path/hash fragments just in case.
  const id = idPart.split(/[/?#]/)[0];
  if (!id) return null;
  const query = queryPart.split("#")[0];
  const params = new URLSearchParams(query);
  const radiusRaw = Number(params.get("radius") ?? "0");
  const radius = Number.isFinite(radiusRaw) ? Math.max(0, Math.min(60, radiusRaw)) : 0;
  const width = Number(params.get("width"));
  const height = Number(params.get("height"));
  return {
    id,
    hasAnnotation: params.get("annotation") === "1",
    radius,
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  };
}


export function PinRoute() {
  useStoredAccentColor();
  const locale = useStoredLanguage();
  const t = createTranslator(locale);
  const [pinRoute] = useState(() => parsePinRoute());
  const id = pinRoute?.id ?? null;
  const hasAnnotation = pinRoute?.hasAnnotation ?? false;
  const radius = pinRoute?.radius ?? 0;
  const [scale, setScale] = useState(1.0);
  const scaleRef = useRef(scale);
  const wheelRef = useRef({ remainder: 0, direction: 0 });
  const { handleMouseDown: armWindowDrag, cancel: cancelWindowDrag } = usePinDrag(() => getCurrentWindow().startDragging());
  const screenshotRef = useRef<HTMLImageElement>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [scaleBadge, setScaleBadge] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editorBaseSelection, setEditorBaseSelection] = useState<Rect | null>(null);
  const editingRef = useRef(editing);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const scaleBadgeTimerRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState(currentViewportSize);
  const originalSize = useRef({ width: pinRoute?.width ?? viewportSize.width, height: pinRoute?.height ?? viewportSize.height });
  const pointerInside = useRef(false);
  const toolsPresence = useRef(new Set<string>());
  const hideTimer = useRef<number | null>(null);
  const hideGeneration = useRef(0);
  const resizingRef = useRef(false);
  const [pinExportScale, setPinExportScale] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotationFileUrl, setAnnotationFileUrl] = useState<string | null>(null);
  const [annotationUrl, setAnnotationUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [annotationReady, setAnnotationReady] = useState(!hasAnnotation);
  const imageAdjustments = useOverlay((s) => s.imageAdjustments);
  const contentReady = imageReady && annotationReady;
  const editorSelection = useMemo(() => pinContentSelection(viewportSize), [viewportSize]);
  const annotationSelection = editorBaseSelection ?? editorSelection;
  const annotationDisplayScale = editorSelection.width / annotationSelection.width;
  const annotationStageScale = visualAnnotationScale(pinExportScale * annotationDisplayScale, annotationDisplayScale);
  const pinImageFilter = frozenLayerFilterForImageAdjustments(imageAdjustments);
  usePublishPinTools(id, { visible: controlsVisible, editing, scale, copyConfirmed, locale, imageAdjustments });

  const showControls = useCallback(() => {
    hideGeneration.current++;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setControlsVisible(true);
  }, []);
  const scheduleHideControls = useCallback(() => {
    const generation = ++hideGeneration.current;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const check = async () => {
      hideTimer.current = null;
      const held = () => pointerInside.current || editingRef.current
        || toolsPresence.current.has("controls-focus") || toolsPresence.current.has("editor-focus");
      if (!id || generation !== hideGeneration.current || held()) return;
      let inside = true;
      try {
        inside = await pinInteractionContainsCursor(id);
      } catch {
        // Keep buttons usable if the native check is temporarily unavailable.
      }
      // Enter/focus can arrive from another webview while this IPC is pending.
      if (generation !== hideGeneration.current || held()) return;
      if (inside) {
        // Continue across the gap even if an inactive palette never emits its
        // DOM mouseenter; stop once the pointer leaves the complete pin group.
        hideTimer.current = window.setTimeout(() => { void check(); }, 120);
      } else {
        toolsPresence.current.clear();
        setControlsVisible(false);
      }
    };
    hideTimer.current = window.setTimeout(() => { void check(); }, 180);
  }, [id]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    return () => {
      hideGeneration.current++;
      if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current);
      if (scaleBadgeTimerRef.current) window.clearTimeout(scaleBadgeTimerRef.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    document.body.classList.add("pin");
    return () => {
      document.body.classList.remove("pin");
    };
  }, []);

  const updatePinExportScale = useCallback((node: HTMLImageElement | null = screenshotRef.current) => {
    if (!node) {
      setPinExportScale(1);
      return;
    }

    const rect = node.getBoundingClientRect();
    const displayWidth = rect.width || editorSelection.width;
    const nextScale = node.naturalWidth > 0 && displayWidth > 0 ? node.naturalWidth / displayWidth : 1;
    setPinExportScale(nextScale > 0 ? nextScale : 1);
  }, [editorSelection.width]);

  useEffect(() => {
    const handleResize = () => {
      const viewport = currentViewportSize();
      setViewportSize(viewport);
      window.requestAnimationFrame(() => updatePinExportScale());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updatePinExportScale]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const cacheDir = await appCacheDir();
        const sep = cacheDir.endsWith("/") || cacheDir.endsWith("\\") ? "" : "/";
        const imagePath = `${cacheDir}${sep}pins/pin-${id}.png`;
        const annotationPath = `${cacheDir}${sep}pins/pin-${id}-annotation.png`;
        const nextAnnotationUrl = convertFileSrc(annotationPath);
        if (!cancelled) {
          setImageUrl(convertFileSrc(imagePath));
          setAnnotationFileUrl(nextAnnotationUrl);
          setAnnotationUrl(hasAnnotation ? nextAnnotationUrl : null);
        }
      } catch {
        if (!cancelled) {
          setImageUrl(null);
          setAnnotationUrl(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, hasAnnotation]);

  const updatePinScale = useCallback(async (nextScale: number) => {
    if (!id || resizingRef.current) return;
    const clamped = clampScale(nextScale);
    if (clamped === scaleRef.current) return;
    scaleRef.current = clamped;
    setScale(clamped);
    setScaleBadge(scaleLabel(clamped));
    if (scaleBadgeTimerRef.current) window.clearTimeout(scaleBadgeTimerRef.current);
    scaleBadgeTimerRef.current = window.setTimeout(() => {
      setScaleBadge(null);
      scaleBadgeTimerRef.current = null;
    }, PIN_SCALE_BADGE_MS);
    try {
      await setPinScale(id, clamped);
    } catch {
      // ignore
    }
  }, [id]);

  const closeCurrentPin = useCallback(async () => {
    if (!id) return;
    try {
      await closePin(id);
    } catch {
      // ignore
    }
  }, [id]);

  const cancelEditMode = useCallback(() => {
    useAnnotation.getState().reset();
    setEditing(false);
  }, []);

  const enterEditMode = useCallback(() => {
    useAnnotation.getState().reset();
    setEditorBaseSelection({ x: 0, y: 0, ...originalSize.current });
    setControlsVisible(true);
    setEditing(true);
  }, []);

  const exportCurrentAnnotation = useCallback(async () => {
    const { exportAnnotationLayer } = await import("@/annotation/export");
    return await exportAnnotationLayer(annotationStageScale);
  }, [annotationStageScale]);

  const currentOutputAdjustments = useCallback(() => {
    const adjustments = useOverlay.getState().imageAdjustments;
    return hasImageAdjustments(adjustments) ? adjustments : undefined;
  }, []);

  const savePinWithCurrentAdjustments = useCallback(async (pinId: string, annotationPng?: ArrayBuffer) => {
    const adjustments = currentOutputAdjustments();
    if (adjustments) return await savePin(pinId, annotationPng, adjustments);
    return await savePin(pinId, annotationPng);
  }, [currentOutputAdjustments]);

  const copyPinWithCurrentAdjustments = useCallback(async (pinId: string, annotationPng?: ArrayBuffer) => {
    const adjustments = currentOutputAdjustments();
    if (adjustments) {
      await copyPin(pinId, annotationPng, adjustments);
      return;
    }
    await copyPin(pinId, annotationPng);
  }, [currentOutputAdjustments]);

  const persistCurrentAnnotation = useCallback(async () => {
    if (!id) return;
    const annotationPng = await exportCurrentAnnotation();
    if (!annotationPng) return;

    await updatePinAnnotation(id, annotationPng);

    if (annotationFileUrl) {
      setAnnotationReady(false);
      setAnnotationUrl(`${annotationFileUrl}?rev=${Date.now()}`);
    }
  }, [annotationFileUrl, exportCurrentAnnotation, id]);

  const exitEditMode = useCallback(async () => {
    try {
      await persistCurrentAnnotation();
      cancelEditMode();
    } catch (error) {
      console.warn("Failed to save pin annotation edits", error);
    }
  }, [cancelEditMode, persistCurrentAnnotation]);

  const toggleEditMode = useCallback(() => {
    if (editingRef.current) {
      void exitEditMode();
      return;
    }
    enterEditMode();
  }, [enterEditMode, exitEditMode]);

  const saveCurrentPin = useCallback(async () => {
    if (!id) return;

    if (editingRef.current) {
      await persistCurrentAnnotation();
      cancelEditMode();
    }
    await savePinWithCurrentAdjustments(id, undefined);
  }, [cancelEditMode, id, persistCurrentAnnotation, savePinWithCurrentAdjustments]);

  const copyCurrentPin = useCallback(async () => {
    if (!id) return;
    const annotationPng = editingRef.current ? await exportCurrentAnnotation() : null;
    await copyPinWithCurrentAdjustments(id, annotationPng ?? undefined);
    setCopyConfirmed(true);
    if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyConfirmed(false);
      copyFeedbackTimerRef.current = null;
    }, PIN_COPY_FEEDBACK_MS);
  }, [copyPinWithCurrentAdjustments, exportCurrentAnnotation, id]);

  useEffect(() => {
    if (!id) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest(
          "[data-pin-controls], [data-image-adjustments-panel], [data-annotation-toolbar], [data-annotation-property-panel]",
        )
      ) {
        return;
      }

      e.preventDefault();
      const delta = normalizedWheelDelta(e);
      if (delta === 0) return;

      const direction = delta > 0 ? -1 : 1;
      const wheel = wheelRef.current;
      if (wheel.direction !== direction) {
        wheel.direction = direction;
        wheel.remainder = 0;
      }

      wheel.remainder += Math.abs(delta);
      if (wheel.remainder < PIN_WHEEL_NOTCH_DELTA) return;
      wheel.remainder = 0;

      void updatePinScale(scaleRef.current + direction * PIN_SCALE_STEP);
    };

    const handleDoubleClick = () => {
      if (!editingRef.current) void closeCurrentPin();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInputLike(document.activeElement)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (editingRef.current) {
          void exitEditMode();
          return;
        }
        void closeCurrentPin();
        return;
      }

      const isCommand = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (isCommand && key === "c") {
        e.preventDefault();
        void copyCurrentPin();
        return;
      }

      if (isCommand && key === "s") {
        e.preventDefault();
        void saveCurrentPin();
        return;
      }

      if (!isCommand && !e.altKey && !e.shiftKey && key === "e" && !editingRef.current) {
        e.preventDefault();
        enterEditMode();
        return;
      }

      if (isCommand && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        void updatePinScale(scaleRef.current + PIN_SCALE_STEP);
        return;
      }

      if (isCommand && e.key === "-") {
        e.preventDefault();
        void updatePinScale(scaleRef.current - PIN_SCALE_STEP);
        return;
      }

      if (isCommand && e.key === "0") {
        e.preventDefault();
        void updatePinScale(1);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, closeCurrentPin, copyCurrentPin, enterEditMode, exitEditMode, saveCurrentPin, updatePinScale]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (!resizingRef.current) armWindowDrag(event);
  }, [armWindowDrag]);

  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    cursor: "move",
    boxSizing: "border-box",
    padding: 0,
    background: "transparent",
    outline: "none",
  };

  const imgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
    boxShadow: PIN_GLOW,
    borderRadius: radius,
    filter: pinImageFilter,
  };

  const annotationStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
    borderRadius: radius,
  };

  const pinActionRef = useRef<(action: PinAction) => void>(() => {});
  pinActionRef.current = (action) => {
    if (action.type === "hover" || action.type === "focus") {
      const key = `${action.kind}-${action.type}`;
      if (action.visible) {
        toolsPresence.current.add(key);
        showControls();
        if (!pointerInside.current) scheduleHideControls();
      }
      else { toolsPresence.current.delete(key); scheduleHideControls(); }
      return;
    }
    const annotation = useAnnotation.getState();
    const execute = async () => {
      switch (action.type) {
        case "edit": toggleEditMode(); break;
        case "close": await closeCurrentPin(); break;
        case "save": await saveCurrentPin(); break;
        case "copy": await copyCurrentPin(); break;
        case "scale": await updatePinScale(action.scale); break;
        case "tool": if (editingRef.current) annotation.setActiveTool(action.tool); break;
        case "style":
          if (editingRef.current && annotation.activeTool === action.tool && annotation.selectedObjectId === action.selectedObjectId) annotation.updateSelectedStyle(action.updates);
          break;
        case "resize-object": if (editingRef.current) annotation.resizeObject(action.id, action.updates); break;
        case "marker-number": if (editingRef.current) annotation.setCurrentMarkerNumber(action.value); break;
        case "undo": if (editingRef.current) annotation.undo(); break;
        case "redo": if (editingRef.current) annotation.redo(); break;
        case "adjustments": useOverlay.getState().setImageAdjustments(action.updates); break;
        case "reset-adjustments": useOverlay.getState().resetImageAdjustments(); break;
      }
    };
    void execute().catch(error => console.warn("Could not apply pin action", error));
  };
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const listener = onPinAction(action => { if (!cancelled) pinActionRef.current(action); });
    return () => {
      cancelled = true;
      void listener.then(unlisten => unlisten()).catch(() => {});
    };
  }, [id]);

  if (!id || !imageUrl) return null;

  return (
    <div
      data-testid="pin-root"
      tabIndex={0}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => {
        pointerInside.current = true;
        showControls();
      }}
      onMouseLeave={() => { pointerInside.current = false; scheduleHideControls(); }}
      onFocusCapture={showControls}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleHideControls();
      }}
    >
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute", pointerEvents: "none" }}>
        <defs><ImageAdjustmentsFilter id={PREVIEW_IMAGE_ADJUSTMENTS_FILTER_ID} adjustments={imageAdjustments} /></defs>
      </svg>
      {scaleBadge && (
        <div
          role="status"
          aria-label={t("pin.scaleStatus", { scale: scaleBadge })}
          style={pinScaleBadgeStyle}
        >
          {scaleBadge}
        </div>
      )}
      <div
        data-testid="pin-image-stack"
        style={{ ...imageStackStyle, borderRadius: radius, opacity: contentReady ? 1 : 0 }}
      >
        <img
          ref={screenshotRef}
          src={imageUrl}
          alt={t("pin.screenshotAlt")}
          data-frozen-layer
          crossOrigin="anonymous"
          style={imgStyle}
          draggable={false}
          onLoad={(event) => {
            setImageReady(true);
            updatePinExportScale(event.currentTarget);
          }}
          onError={() => setImageReady(true)}
        />
        {annotationUrl && (
          <img
            src={annotationUrl}
            alt={t("pin.annotationsAlt")}
            style={annotationStyle}
            draggable={false}
            onLoad={() => setAnnotationReady(true)}
            onError={() => setAnnotationReady(true)}
          />
        )}
        {editing && (
          <Suspense fallback={null}>
            <AnnotationStage
              selection={annotationSelection}
              displayScale={annotationDisplayScale}
              scaleFactor={annotationStageScale}
              frameUrl={imageUrl}
              interacting={false}
              selectionEditable={false}
            />
          </Suspense>
        )}
      </div>
      <div data-pin-rim style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: radius, boxShadow: PIN_GLOW }} />
      <PinResizeHandles pinId={id}
        onResizingChange={active => { resizingRef.current = active; cancelWindowDrag(); }}
        onScale={next => {
          scaleRef.current = next;
          setScale(next);
          setScaleBadge(scaleLabel(next));
          if (scaleBadgeTimerRef.current) window.clearTimeout(scaleBadgeTimerRef.current);
          scaleBadgeTimerRef.current = window.setTimeout(() => setScaleBadge(null), PIN_SCALE_BADGE_MS);
        }} />
    </div>
  );
}

const imageStackStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
};


const pinScaleBadgeStyle: CSSProperties = {
  position: "absolute", left: 8, top: 8, padding: "3px 6px", borderRadius: 4,
  background: FLOATING_LABEL_BACKGROUND, color: ACCENT_COLOR_CSS_VAR,
  fontSize: 11, lineHeight: 1, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  fontVariantNumeric: "tabular-nums", pointerEvents: "none", zIndex: 12,
};
