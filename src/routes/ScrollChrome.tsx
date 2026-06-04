import { useEffect, useState, type CSSProperties } from "react";
import type { ScrollProgress } from "@/lib/types";
import { createTranslator } from "@/i18n";
import {
  onScrollProgress,
} from "@/lib/ipc";
import {
  SCREENSHOT_TOOLBAR_BORDER,
  SCREENSHOT_TOOLBAR_RADIUS,
} from "@/overlay/Toolbar";
import { useStoredLanguage } from "@/settings/useStoredAccentColor";

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
  borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
  boxShadow: "0 12px 36px rgba(0,0,0,0.34)",
  border: SCREENSHOT_TOOLBAR_BORDER,
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
  height: "100%",
  objectFit: "cover",
  objectPosition: "bottom center",
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
  borderRadius: 999,
  background: "rgba(0,0,0,0.42)",
  border: "1px solid rgba(255,255,255,0.16)",
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

export function ScrollChromeRoute() {
  const t = createTranslator(useStoredLanguage());
  const [parsed] = useState(() => parseScrollChromeRoute());
  const [progress, setProgress] = useState<ScrollProgress | null>(null);

  useEffect(() => {
    const sub = onScrollProgress((p) => setProgress(p));
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const statusText = t("scroll.framesStatus", { frames: progress?.frames ?? 0, height: progress?.height ?? 0 });

  if (!parsed) return null;

  return (
    <div style={panelStyle}>
      {progress?.previewDataUrl ? (
        <img
          src={progress.previewDataUrl}
          alt=""
          draggable={false}
          style={previewImageStyle}
        />
      ) : (
        <div aria-hidden="true" style={previewFallbackStyle} />
      )}
      <div data-scroll-status-pill style={statusPillStyle}>
        {statusText}
      </div>
    </div>
  );
}
