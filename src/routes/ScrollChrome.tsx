import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrollEndReason, ScrollProgress } from "@/lib/types";
import { createTranslator } from "@/i18n";
import {
  onScrollEndDetected,
  onScrollMatchFailed,
  onScrollProgress,
  scrollCopy,
  scrollSave,
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
  const [finalized, setFinalized] = useState<{ width: number; height: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<ScrollEndReason | null>(null);
  const [busy, setBusy] = useState<"done" | "copy" | "save" | null>(null);
  const finalizingRef = useRef(false);

  const finalize = useCallback(async () => {
    if (finalizingRef.current || finalized) return;
    finalizingRef.current = true;
    setBusy("done");
    try {
      const r = await stopScrollSession(true);
      if (r) setFinalized({ width: r.width, height: r.height });
    } finally {
      setBusy(null);
      finalizingRef.current = false;
    }
  }, [finalized]);

  useEffect(() => {
    const sub = onScrollProgress((p) => setProgress(p));
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const p = onScrollMatchFailed(({ consecutiveFailures }) => {
      if (consecutiveFailures >= 5) {
        setToast(t("scroll.cantDetect"));
        window.setTimeout(() => setToast(null), 3000);
      }
    });
    return () => {
      p.then((u) => u()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const p = onScrollEndDetected((reason) => {
      setEndReason(reason);
    });
    return () => {
      p.then((u) => u()).catch(() => {});
    };
  }, []);

  const onDone = finalize;
  const onCancel = async () => {
    await stopScrollSession(false);
  };
  const onCopy = async () => {
    if (busy) return;
    setBusy("copy");
    try {
      await scrollCopy();
    } finally {
      setBusy(null);
    }
  };
  const onSave = async () => {
    if (busy) return;
    setBusy("save");
    try {
      await scrollSave();
    } finally {
      setBusy(null);
    }
  };

  const statusText = endReason
    ? endReason === "max-height"
      ? t("scroll.maxLength")
      : t("scroll.bottomReached")
    : t("scroll.framesStatus", { frames: progress?.frames ?? 0, height: progress?.height ?? 0 });

  if (!parsed) return null;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
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
        padding: "10px 12px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {toast && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            right: 8,
            background: "rgba(220, 38, 38, 0.95)",
            color: "white",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            textAlign: "center",
            zIndex: 10,
          }}
        >
          {toast}
        </div>
      )}

      {finalized ? (
        <>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: 0.9,
            }}
          >
            {finalized.width}×{finalized.height}
          </span>
          <div style={{ display: "flex", flexShrink: 0, gap: 8 }}>
            <button
              type="button"
              onClick={onCopy}
              disabled={!!busy}
              style={{ ...BTN_BASE, background: "#60a5fa", color: "white" }}
            >
              {busy === "copy" ? t("scroll.copying") : t("scroll.copy")}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!!busy}
              style={{ ...BTN_BASE, background: "#4ade80", color: "#0a2a17" }}
            >
              {busy === "save" ? t("scroll.saving") : t("scroll.save")}
            </button>
          </div>
        </>
      ) : (
        <>
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              opacity: 0.85,
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {statusText}
          </span>
          <div style={{ display: "flex", flexShrink: 0, gap: 8 }}>
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
              style={{
                ...BTN_BASE,
                background: "rgba(255,255,255,0.12)",
                color: "white",
              }}
            >
              {t("scroll.cancel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
