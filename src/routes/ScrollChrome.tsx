import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollProgress } from "@/lib/types";
import { createTranslator } from "@/i18n";
import {
  onScrollProgress,
  scrollPin,
  stopScrollSession,
} from "@/lib/ipc";
import {
  SCREENSHOT_TOOLBAR_BACKGROUND,
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

const BTN_BASE: React.CSSProperties = {
  border: 0,
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

export function ScrollChromeRoute() {
  const t = createTranslator(useStoredLanguage());
  const [parsed] = useState(() => parseScrollChromeRoute());
  const [progress, setProgress] = useState<ScrollProgress | null>(null);
  const [busy, setBusy] = useState<"done" | null>(null);
  const finalizingRef = useRef(false);

  const finalize = useCallback(async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    setBusy("done");
    try {
      await scrollPin();
    } finally {
      setBusy(null);
      finalizingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const sub = onScrollProgress((p) => setProgress(p));
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const onDone = finalize;
  const onCancel = async () => {
    await stopScrollSession(false);
  };
  const statusText = t("scroll.framesStatus", { frames: progress?.frames ?? 0, height: progress?.height ?? 0 });

  if (!parsed) return null;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        background: SCREENSHOT_TOOLBAR_BACKGROUND,
        color: "white",
        borderRadius: SCREENSHOT_TOOLBAR_RADIUS,
        boxShadow: "none",
        border: SCREENSHOT_TOOLBAR_BORDER,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        overflow: "hidden",
        position: "relative",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          flex: 1,
          position: "relative",
          background: "rgba(0,0,0,0.35)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {progress?.previewDataUrl ? (
          <img
            src={progress.previewDataUrl}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "bottom center",
              userSelect: "none",
            }}
          />
        ) : (
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
            {t("scroll.prompt")}
          </span>
        )}
      </div>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(0,0,0,0.55)",
          fontSize: 13,
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span style={{ opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
          {statusText}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onDone}
            disabled={!!busy}
            style={{ ...BTN_BASE, background: "#60a5fa", color: "white" }}
          >
            {busy === "done" ? t("scroll.finishing") : t("scroll.done")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...BTN_BASE, background: "rgba(255,255,255,0.12)", color: "white" }}
          >
            {t("scroll.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
