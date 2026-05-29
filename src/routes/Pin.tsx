import { exportAnnotationLayer } from "@/annotation/export";
import { AnnotationStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import { Toolbar as AnnotationToolbar } from "@/annotation/Toolbar";
import { TooltipBubble } from "@/annotation/Tooltip";
import { createTranslator, type Locale } from "@/i18n";
import { ACCENT_COLOR_CSS_VAR, ACCENT_RGB_CSS_VAR } from "@/lib/colors";
import { FLOATING_LABEL_BACKGROUND } from "@/lib/floating-surface";
import { TOOLBAR_GAP } from "@/lib/geometry";
import { closePin, copyPin, savePin, setPinScale, updatePinAnnotation } from "@/lib/ipc";
import type { Rect } from "@/lib/types";
import { ImageAdjustmentsPanel } from "@/overlay/ImageAdjustmentsPanel";
import { cssFilterForImageAdjustments, hasImageAdjustments } from "@/overlay/imageAdjustments";
import { useOverlay } from "@/overlay/state";
import { useStoredAccentColor, useStoredLanguage } from "@/settings/useStoredAccentColor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CheckIcon, CopyIcon, ImageIcon, SaveIcon, Scaling, SquarePen, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

// Soft outer glow around the pinned image. The window itself reserves
// PIN_SHADOW_PADDING px on each side (matched in commands.rs) so these
// shadows have room to render without being clipped by the window edge.
const PIN_SHADOW_PADDING = 24;
const PIN_SCALE_MIN = 0.5;
const PIN_SCALE_MAX = 3;
const PIN_SCALE_STEP = 0.05;
const PIN_WHEEL_NOTCH_DELTA = 100;
const PIN_WHEEL_LINE_DELTA = 16;
const PIN_WHEEL_PAGE_DELTA = 800;
const PIN_CONTROLS_WIDTH = 40;
const PIN_CONTROLS_GAP = 8;
const PIN_CONTROLS_SIDE_RESERVE = PIN_CONTROLS_WIDTH + PIN_CONTROLS_GAP;
const PIN_TOOLBAR_BOTTOM_RESERVE = PIN_CONTROLS_SIDE_RESERVE;
const PIN_ADJUSTMENTS_PANEL_WIDTH = 220;
const PIN_COPY_FEEDBACK_MS = 900;
const PIN_SCALE_BADGE_MS = 900;
const PIN_GLOW = [
  // Tight rim - barely-there definition right at the image edge.
  `0 0 1px rgba(${ACCENT_RGB_CSS_VAR}, 0.6)`,
  // Inner halo - most of the visible color.
  `0 0 6px rgba(${ACCENT_RGB_CSS_VAR}, 0.5)`,
  // Mid bloom.
  `0 0 14px rgba(${ACCENT_RGB_CSS_VAR}, 0.34)`,
  // Outer feathered fall-off.
  `0 0 22px rgba(${ACCENT_RGB_CSS_VAR}, 0.2)`,
].join(", ");

type PinControlsSide = "left" | "right";


function clampScale(scale: number): number {
  const clamped = Math.max(PIN_SCALE_MIN, Math.min(PIN_SCALE_MAX, scale));
  return Math.round(clamped * 100) / 100;
}

function scalePercent(scale: number): number {
  return Math.round(scale * 100);
}

function scaleLabel(scale: number): string {
  return `${scalePercent(scale)}%`;
}

function visualAnnotationScale(exportScale: number): number {
  const deviceScale = Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return Math.max(1, exportScale, deviceScale);
}

function shortcutTitle(action: string, key: string): string {
  const isMac = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform);
  const modifier = isMac ? "Cmd" : "Ctrl";
  return `${action} (${modifier}+${key})`;
}

function buildScaleOptions(): number[] {
  const count = Math.round((PIN_SCALE_MAX - PIN_SCALE_MIN) / PIN_SCALE_STEP) + 1;
  return Array.from({ length: count }, (_, index) => clampScale(PIN_SCALE_MIN + index * PIN_SCALE_STEP));
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
    width: Math.max(1, viewport.width - 2 * PIN_SHADOW_PADDING - PIN_CONTROLS_SIDE_RESERVE),
    height: Math.max(1, viewport.height - 2 * PIN_SHADOW_PADDING - PIN_TOOLBAR_BOTTOM_RESERVE),
  };
}

function pinToolbarSelection(content: Rect): Rect {
  return {
    ...content,
    x: PIN_SHADOW_PADDING,
    y: PIN_SHADOW_PADDING,
  };
}

function pinMonitorRect(viewport: { width: number; height: number }): Rect {
  return { x: 0, y: 0, width: viewport.width, height: viewport.height };
}

function parsePinRoute(): { id: string; hasAnnotation: boolean; radius: number } | null {
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
  return {
    id,
    hasAnnotation: params.get("annotation") === "1",
    radius,
  };
}

function computePinControlsSide(_viewport: { width: number; height: number }): PinControlsSide {
  return "right";
}

function isTextInputLike(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
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
  const screenshotRef = useRef<HTMLImageElement>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [scaleMenuOpen, setScaleMenuOpen] = useState(false);
  const [adjustmentsPanelOpen, setAdjustmentsPanelOpen] = useState(false);
  const [controlsSide, setControlsSide] = useState<PinControlsSide>("right");
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [scaleBadge, setScaleBadge] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const scaleBadgeTimerRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState(currentViewportSize);
  const [pinExportScale, setPinExportScale] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotationFileUrl, setAnnotationFileUrl] = useState<string | null>(null);
  const [annotationUrl, setAnnotationUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [annotationReady, setAnnotationReady] = useState(!hasAnnotation);
  const imageAdjustments = useOverlay((s) => s.imageAdjustments);
  const contentReady = imageReady && annotationReady;
  const scaleOptions = useMemo(buildScaleOptions, []);
  const editorSelection = useMemo(() => pinContentSelection(viewportSize), [viewportSize]);
  const editorToolbarSelection = useMemo(() => pinToolbarSelection(editorSelection), [editorSelection]);
  const editorMonitorRect = useMemo(() => pinMonitorRect(viewportSize), [viewportSize]);
  const annotationStageScale = visualAnnotationScale(pinExportScale);
  const pinImageFilter = cssFilterForImageAdjustments(imageAdjustments);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current);
      if (scaleBadgeTimerRef.current) window.clearTimeout(scaleBadgeTimerRef.current);
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
    setPinExportScale(Math.max(1, nextScale));
  }, [editorSelection.width]);

  const updateControlsSide = useCallback(() => {
    setControlsSide(computePinControlsSide(currentViewportSize()));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewportSize(currentViewportSize());
      updateControlsSide();
      window.requestAnimationFrame(() => updatePinExportScale());
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateControlsSide, updatePinExportScale]);

  useEffect(() => {
    if (!controlsVisible) return;
    updateControlsSide();
    const interval = window.setInterval(updateControlsSide, 250);
    return () => window.clearInterval(interval);
  }, [controlsVisible, updateControlsSide]);

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
    if (!id) return;
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
    setScaleMenuOpen(false);
    setAdjustmentsPanelOpen(false);
    setControlsVisible(true);
    setEditing(true);
  }, []);

  const exportCurrentAnnotation = useCallback(async () => {
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

  const hideControls = () => {
    setControlsVisible(false);
    setScaleMenuOpen(false);
    setAdjustmentsPanelOpen(false);
  };

  const handleMouseDown = async () => {
    try {
      await getCurrentWebviewWindow().startDragging();
    } catch {
      // ignore
    }
  };

  const containerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    cursor: "move",
    boxSizing: "border-box",
    padding: `${PIN_SHADOW_PADDING}px ${PIN_SHADOW_PADDING + PIN_CONTROLS_SIDE_RESERVE}px ${PIN_SHADOW_PADDING + PIN_TOOLBAR_BOTTOM_RESERVE}px ${PIN_SHADOW_PADDING}px`,
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

  if (!id || !imageUrl) return null;

  return (
    <div
      data-testid="pin-root"
      tabIndex={0}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => {
        updateControlsSide();
        setControlsVisible(true);
      }}
      onMouseLeave={hideControls}
      onFocusCapture={() => {
        updateControlsSide();
        setControlsVisible(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideControls();
      }}
    >
      {controlsVisible && (
        <PinControls
          scale={scale}
          scaleOptions={scaleOptions}
          scaleMenuOpen={scaleMenuOpen}
          adjustmentsPanelOpen={adjustmentsPanelOpen}
          controlsSide={controlsSide}
          copyConfirmed={copyConfirmed}
          locale={locale}
          onToggleScaleMenu={() => {
            setAdjustmentsPanelOpen(false);
            setScaleMenuOpen((open) => !open);
          }}
          onToggleAdjustmentsPanel={() => {
            setScaleMenuOpen(false);
            setAdjustmentsPanelOpen((open) => !open);
          }}
          onScaleSelect={(nextScale) => {
            setScaleMenuOpen(false);
            void updatePinScale(nextScale);
          }}
          editing={editing}
          onEdit={toggleEditMode}
          onClose={closeCurrentPin}
          onSave={() => void saveCurrentPin()}
          onCopy={() => void copyCurrentPin()}
        />
      )}
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
        style={{ ...imageStackStyle, opacity: contentReady ? 1 : 0 }}
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
          <AnnotationStage
            selection={editorSelection}
            scaleFactor={annotationStageScale}
            frameUrl={imageUrl}
            interacting={false}
          />
        )}
      </div>
      {editing && (
        <AnnotationToolbar
          locale={locale}
          opaqueSurface
          selection={editorToolbarSelection}
          monitorRect={editorMonitorRect}
        />
      )}
    </div>
  );
}

const imageStackStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
};


type PinControlsProps = {
  scale: number;
  scaleOptions: number[];
  scaleMenuOpen: boolean;
  adjustmentsPanelOpen: boolean;
  controlsSide: PinControlsSide;
  copyConfirmed: boolean;
  editing: boolean;
  locale?: Locale;
  onToggleScaleMenu: () => void;
  onToggleAdjustmentsPanel: () => void;
  onScaleSelect: (scale: number) => void;
  onEdit: () => void;
  onClose: () => void;
  onSave: () => void;
  onCopy: () => void;
};

function PinControls({
  scale,
  scaleOptions,
  scaleMenuOpen,
  adjustmentsPanelOpen,
  controlsSide,
  copyConfirmed,
  editing,
  locale = "en",
  onToggleScaleMenu,
  onToggleAdjustmentsPanel,
  onScaleSelect,
  onEdit,
  onClose,
  onSave,
  onCopy,
}: PinControlsProps) {
  const t = createTranslator(locale);
  const editLabel = `${t("pin.edit")} (E)`;
  const adjustmentsLabel = t("screenshot.imageAdjustments");
  const scaleControlLabel = t("pin.scaleShortcut", { scale: scaleLabel(scale) });
  const closeLabel = `${t("screenshot.close")} (Esc)`;
  const saveLabel = shortcutTitle(t("screenshot.saveAs"), "S");
  const copyLabel = shortcutTitle(t("screenshot.copy"), "C");

  return (
    <div
      data-testid="pin-controls"
      data-pin-controls
      data-pin-controls-side={controlsSide}
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={pinControlsStyleForSide(controlsSide)}
    >
      <PinControlButton
        label={editLabel}
        placement={controlsSide}
        icon={<SquarePen size={18} aria-hidden="true" />}
        active={editing}
        onClick={onEdit}
      />
      <div style={{ position: "relative" }}>
        <PinControlButton
          label={adjustmentsLabel}
          placement={controlsSide}
          icon={<ImageIcon size={18} aria-hidden="true" />}
          active={adjustmentsPanelOpen}
          onClick={onToggleAdjustmentsPanel}
        />
        {adjustmentsPanelOpen && (
          <ImageAdjustmentsPanel
            locale={locale}
            style={pinAdjustmentsPanelStyleForSide(controlsSide)}
          />
        )}
      </div>
      <div style={{ position: "relative" }}>
        <PinControlButton
          label={scaleControlLabel}
          placement={controlsSide}
          icon={<Scaling size={18} aria-hidden="true" />}
          active={scaleMenuOpen}
          onClick={onToggleScaleMenu}
        />
        {scaleMenuOpen && (
          <div
            data-testid="pin-scale-options"
            className="flashot-dark-scrollbar"
            onWheel={(event) => event.stopPropagation()}
            style={pinScaleOptionsStyleForSide(controlsSide)}
          >
            {scaleOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={t("pin.scale", { scale: scaleLabel(option) })}
                onClick={() => onScaleSelect(option)}
                style={{
                  ...pinScaleOptionStyle,
                  background: option === scale ? "rgba(255,255,255,0.16)" : "transparent",
                }}
              >
                {scaleLabel(option)}
              </button>
            ))}
          </div>
        )}
      </div>
      <PinControlButton
        label={closeLabel}
        placement={controlsSide}
        icon={<XIcon size={18} aria-hidden="true" />}
        tone="danger"
        onClick={onClose}
      />
      <PinControlButton
        label={saveLabel}
        placement={controlsSide}
        icon={<SaveIcon size={18} aria-hidden="true" />}
        tone="primary"
        onClick={onSave}
      />
      <PinControlButton
        label={copyLabel}
        placement={controlsSide}
        icon={copyConfirmed ? <CheckIcon size={18} aria-hidden="true" /> : <CopyIcon size={18} aria-hidden="true" />}
        tone="success"
        onClick={onCopy}
      />
    </div>
  );
}

function PinControlButton({
  label,
  icon,
  onClick,
  active,
  placement,
  tone = "default",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  placement: PinControlsSide;
  tone?: "default" | "danger" | "primary" | "success";
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const color = {
    default: "rgba(255,255,255,0.78)",
    danger: "#f87171",
    primary: "#60a5fa",
    success: "#4ade80",
  }[tone];

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      style={{
        ...pinControlButtonStyle,
        background: active ? "rgba(255,255,255,0.16)" : "transparent",
        color,
      }}
    >
      {icon}
      {tooltipVisible && <TooltipBubble label={label} anchorRef={buttonRef} placement={placement} />}
    </button>
  );
}

function pinControlsStyleForSide(side: PinControlsSide): CSSProperties {
  return {
    ...pinControlsBaseStyle,
    ...(side === "right"
      ? { right: PIN_SHADOW_PADDING + TOOLBAR_GAP }
      : { left: PIN_SHADOW_PADDING + TOOLBAR_GAP }),
  };
}

const pinControlsBaseStyle: CSSProperties = {
  position: "absolute",
  top: PIN_SHADOW_PADDING + TOOLBAR_GAP,
  width: PIN_CONTROLS_WIDTH,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "4px 0",
  borderRadius: 10,
  background: "rgb(30, 30, 30)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#f0f0f5",
  pointerEvents: "auto",
  userSelect: "none",
  zIndex: 10,
};

const pinControlButtonStyle: CSSProperties = {
  position: "relative",
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  flexShrink: 0,
};

const pinScaleBadgeStyle: CSSProperties = {
  position: "absolute",
  left: PIN_SHADOW_PADDING + 6,
  top: PIN_SHADOW_PADDING - 22,
  padding: "2px 6px",
  borderRadius: 4,
  background: FLOATING_LABEL_BACKGROUND,
  color: ACCENT_COLOR_CSS_VAR,
  fontSize: 11,
  lineHeight: 1,
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  fontVariantNumeric: "tabular-nums",
  pointerEvents: "none",
  zIndex: 12,
};

function pinScaleOptionsStyleForSide(side: PinControlsSide): CSSProperties {
  return {
    position: "absolute",
    ...(side === "right"
      ? { right: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }
      : { left: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }),
    top: 0,
    width: 72,
    maxHeight: 220,
    overflowY: "auto",
    overflowX: "hidden",
    padding: 4,
    borderRadius: 8,
    background: "rgba(30, 30, 30, 0.95)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  };
}

function pinAdjustmentsPanelStyleForSide(side: PinControlsSide): CSSProperties {
  return {
    position: "absolute",
    ...(side === "right"
      ? { right: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }
      : { left: `calc(100% + ${PIN_CONTROLS_GAP - 2}px)` }),
    top: 0,
    width: PIN_ADJUSTMENTS_PANEL_WIDTH,
  };
}

const pinScaleOptionStyle: CSSProperties = {
  width: "100%",
  height: 24,
  border: "none",
  borderRadius: 5,
  color: "#fff",
  cursor: "pointer",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};
