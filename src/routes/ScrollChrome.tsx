import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ScrollProgress } from "@/lib/types";
import { createTranslator } from "@/i18n";
import {
  onScrollMaxHeight,
  onScrollProgress,
  scrollPin,
} from "@/lib/ipc";
import {
  SCREENSHOT_TOOLBAR_BACKGROUND,
  SCREENSHOT_TOOLBAR_BORDER,
  SCREENSHOT_TOOLBAR_RADIUS,
} from "@/overlay/Toolbar";
import { useStoredAccentColor, useStoredLanguage } from "@/settings/useStoredAccentColor";
import { CheckIcon } from "lucide-react";

function parseScrollChromeRoute(): { monitorId: number } | null {
  const h = window.location.hash || "";
  const prefix = "#/scroll-chrome/";
  if (!h.startsWith(prefix)) return null;
  const rest = h.slice(prefix.length);
  const idPart = rest.split(/[/?#]/)[0];
  const monitorId = Number(idPart);
  if (!Number.isFinite(monitorId)) return null;
  return { monitorId };
}

const panelStyle: CSSProperties = {
  width: "100vw",
  height: "100vh",
  boxSizing: "border-box",
  pointerEvents: "auto",
  background: "rgba(24, 24, 24, 0.62)",
  color: "white",
  borderRadius: 0,
  boxShadow: "0 12px 36px rgba(0,0,0,0.34)",
  border: "1px solid rgba(var(--flashot-accent-rgb), 0.9)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  overflow: "hidden",
  position: "relative",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const previewImageStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  bottom: 0,
  width: "100%",
  height: "auto",
  transition: "transform 140ms ease-out, opacity 140ms ease-out",
  userSelect: "none",
};

const previewFallbackStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(255,255,255,0.05)",
};

const statusPillStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 12,
  transform: "translateX(-50%)",
  padding: "5px 10px",
  borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
  background: SCREENSHOT_TOOLBAR_BACKGROUND,
  border: SCREENSHOT_TOOLBAR_BORDER,
  color: "rgba(255,255,255,0.92)",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};

const finishButtonStyle: CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 10,
  width: 30,
  height: 30,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: SCREENSHOT_TOOLBAR_BORDER,
  borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
  background: SCREENSHOT_TOOLBAR_BACKGROUND,
  color: "#4ade80",
  opacity: 1,
  cursor: "pointer",
  pointerEvents: "auto",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  boxShadow: "0 8px 22px rgba(16,185,129,0.26), inset 0 1px 0 rgba(255,255,255,0.24)",
};

export function ScrollChromeRoute() {
  useStoredAccentColor();
  const t = createTranslator(useStoredLanguage());
  const [parsed] = useState(() => parseScrollChromeRoute());
  const [progress, setProgress] = useState<ScrollProgress | null>(null);
  const finishingRef = useRef(false);

  // Single entry point for finishing the capture: the check button and the
  // backend's max-height signal both funnel through here, and the ref guard
  // ensures scroll_pin (which consumes the session) runs at most once even
  // if the signal lands in the same instant as a click.
  const finishPin = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    scrollPin().catch(() => {
      finishingRef.current = false;
    });
  }, []);

  useEffect(() => {
    const sub = onScrollProgress((p) => setProgress(p));
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const sub = onScrollMaxHeight(finishPin);
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [finishPin]);

  const statusText = t("scroll.framesStatus", { frames: progress?.frames ?? 0, height: progress?.height ?? 0 });

  if (!parsed) return null;

  return (
    <div style={panelStyle}>
      {progress?.previewDataUrl ? (
        <img
          src={progress.previewDataUrl}
          alt=""
          draggable={false}
          data-scroll-preview-height={progress.height}
          style={previewImageStyle}
        />
      ) : (
        <div aria-hidden="true" style={previewFallbackStyle} />
      )}
      <div data-scroll-status-pill style={statusPillStyle}>
        {statusText}
      </div>
      {(progress?.frames ?? 0) > 0 && (
        <button
          type="button"
          aria-label={t("scroll.finishPin")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={finishPin}
          style={finishButtonStyle}
        >
          <CheckIcon size={17} strokeWidth={3} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
