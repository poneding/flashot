import { exportAnnotationLayer } from "@/annotation/export";
import { AnnotationStage } from "@/annotation/Stage";
import { useAnnotation } from "@/annotation/store";
import { Toolbar as AnnotationToolbar } from "@/annotation/Toolbar";
import { ACCENT_RGB_CSS_VAR } from "@/lib/colors";
import { closePin, copyPin, setPinScale, updatePinAnnotation } from "@/lib/ipc";
import type { Rect } from "@/lib/types";
import { useStoredAccentColor } from "@/settings/useStoredAccentColor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CopyIcon, Pencil, SaveIcon, Scaling, XIcon } from "lucide-react";
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
    width: Math.max(1, viewport.width - 2 * PIN_SHADOW_PADDING),
    height: Math.max(1, viewport.height - 2 * PIN_SHADOW_PADDING),
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

export function PinRoute() {
  useStoredAccentColor();
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
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  const [viewportSize, setViewportSize] = useState(currentViewportSize);
  const [pinExportScale, setPinExportScale] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [annotationFileUrl, setAnnotationFileUrl] = useState<string | null>(null);
  const [annotationUrl, setAnnotationUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [annotationReady, setAnnotationReady] = useState(!hasAnnotation);
  const contentReady = imageReady && annotationReady;
  const scaleOptions = useMemo(buildScaleOptions, []);
  const editorSelection = useMemo(() => pinContentSelection(viewportSize), [viewportSize]);
  const editorToolbarSelection = useMemo(() => pinToolbarSelection(editorSelection), [editorSelection]);
  const editorMonitorRect = useMemo(() => pinMonitorRect(viewportSize), [viewportSize]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

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

  useEffect(() => {
    const handleResize = () => {
      setViewportSize(currentViewportSize());
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
    if (!id) return;
    const clamped = clampScale(nextScale);
    if (clamped === scaleRef.current) return;
    scaleRef.current = clamped;
    setScale(clamped);
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
    setControlsVisible(true);
    setEditing(true);
  }, []);

  const exportCurrentAnnotation = useCallback(async () => {
    return await exportAnnotationLayer(pinExportScale);
  }, [pinExportScale]);

  const saveCurrentPin = useCallback(async () => {
    if (!id || !editingRef.current) return;
    const annotationPng = await exportCurrentAnnotation();
    if (!annotationPng) {
      cancelEditMode();
      return;
    }

    await updatePinAnnotation(id, annotationPng);

    if (annotationFileUrl) {
      setAnnotationReady(false);
      setAnnotationUrl(`${annotationFileUrl}?rev=${Date.now()}`);
    }

    cancelEditMode();
  }, [annotationFileUrl, cancelEditMode, exportCurrentAnnotation, id]);

  const copyCurrentPin = useCallback(async () => {
    if (!id) return;
    const annotationPng = editingRef.current ? await exportCurrentAnnotation() : null;
    await copyPin(id, annotationPng ?? undefined);
  }, [exportCurrentAnnotation, id]);

  useEffect(() => {
    if (!id) return;

    const handleWheel = (e: WheelEvent) => {
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
      if (e.key === "Escape") {
        e.preventDefault();
        if (editingRef.current) {
          cancelEditMode();
          return;
        }
        void closeCurrentPin();
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
  }, [id, cancelEditMode, closeCurrentPin, updatePinScale]);

  const hideControls = () => {
    setControlsVisible(false);
    setScaleMenuOpen(false);
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
    padding: PIN_SHADOW_PADDING,
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
      onMouseEnter={() => setControlsVisible(true)}
      onMouseLeave={hideControls}
      onFocusCapture={() => setControlsVisible(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideControls();
      }}
    >
      {controlsVisible && (
        <PinControls
          scale={scale}
          scaleOptions={scaleOptions}
          scaleMenuOpen={scaleMenuOpen}
          onToggleScaleMenu={() => setScaleMenuOpen((open) => !open)}
          onScaleSelect={(nextScale) => {
            setScaleMenuOpen(false);
            void updatePinScale(nextScale);
          }}
          editing={editing}
          onEdit={enterEditMode}
          onClose={closeCurrentPin}
          onSave={() => void saveCurrentPin()}
          onCopy={() => void copyCurrentPin()}
        />
      )}
      <div
        data-testid="pin-image-stack"
        style={{ ...imageStackStyle, opacity: contentReady ? 1 : 0 }}
      >
        <img
          ref={screenshotRef}
          src={imageUrl}
          alt="Pinned screenshot"
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
            alt="Pinned annotations"
            style={annotationStyle}
            draggable={false}
            onLoad={() => setAnnotationReady(true)}
            onError={() => setAnnotationReady(true)}
          />
        )}
        {editing && (
          <AnnotationStage
            selection={editorSelection}
            scaleFactor={pinExportScale}
            frameUrl={imageUrl}
            interacting={false}
          />
        )}
      </div>
      {editing && (
        <AnnotationToolbar
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
  editing: boolean;
  onToggleScaleMenu: () => void;
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
  editing,
  onToggleScaleMenu,
  onScaleSelect,
  onEdit,
  onClose,
  onSave,
  onCopy,
}: PinControlsProps) {
  return (
    <div
      data-testid="pin-controls"
      onMouseDown={(event) => event.stopPropagation()}
      style={pinControlsStyle}
    >
      <PinControlButton label="Edit" icon={<Pencil size={18} aria-hidden="true" />} active={editing} onClick={onEdit} />
      <div style={{ position: "relative" }}>
        <PinControlButton
          label={`Scale: ${scaleLabel(scale)}`}
          icon={<Scaling size={18} aria-hidden="true" />}
          active={scaleMenuOpen}
          onClick={onToggleScaleMenu}
        />
        {scaleMenuOpen && (
          <div data-testid="pin-scale-options" style={pinScaleOptionsStyle}>
            {scaleOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Scale: ${scaleLabel(option)}`}
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
      <PinControlButton label="Close" icon={<XIcon size={18} aria-hidden="true" />} tone="danger" onClick={onClose} />
      <PinControlButton label="Save" icon={<SaveIcon size={18} aria-hidden="true" />} tone="primary" onClick={onSave} />
      <PinControlButton label="Copy" icon={<CopyIcon size={18} aria-hidden="true" />} tone="success" onClick={onCopy} />
    </div>
  );
}

function PinControlButton({
  label,
  icon,
  onClick,
  active,
  tone = "default",
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  tone?: "default" | "danger" | "primary" | "success";
}) {
  const color = {
    default: "rgba(255,255,255,0.78)",
    danger: "#f87171",
    primary: "#60a5fa",
    success: "#4ade80",
  }[tone];

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        ...pinControlButtonStyle,
        background: active ? "rgba(255,255,255,0.16)" : "transparent",
        color,
      }}
    >
      {icon}
    </button>
  );
}

const pinControlsStyle: CSSProperties = {
  position: "absolute",
  right: PIN_SHADOW_PADDING + 4,
  top: PIN_SHADOW_PADDING + 4,
  width: 40,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 2,
  padding: "4px 0",
  borderRadius: 10,
  background: "rgba(30, 30, 30, 0.85)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
  border: "1px solid rgba(255,255,255,0.1)",
  pointerEvents: "auto",
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

const pinScaleOptionsStyle: CSSProperties = {
  position: "absolute",
  right: "calc(100% + 6px)",
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
