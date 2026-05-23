import { useEffect, useState } from "react";
import type { ScrollProgress } from "@/lib/types";
import { onScrollMatchFailed, onScrollProgress, scrollCopy, scrollSave, stopScrollSession } from "@/lib/ipc";

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
  const [parsed] = useState(() => parseScrollChromeRoute());
  const [progress, setProgress] = useState<ScrollProgress | null>(null);
  const [finalized, setFinalized] = useState<{ width: number; height: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const sub = onScrollProgress((p) => setProgress(p));
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const p = onScrollMatchFailed(({ consecutiveFailures }) => {
      if (consecutiveFailures >= 5) {
        setToast("Can't detect scroll — try scrolling more slowly.");
        window.setTimeout(() => setToast(null), 3000);
      }
    });
    return () => {
      p.then((u) => u()).catch(() => {});
    };
  }, []);

  const onDone = async () => {
    const r = await stopScrollSession(true);
    if (r) setFinalized({ width: r.width, height: r.height });
  };
  const onCancel = async () => {
    await stopScrollSession(false);
  };
  const onCopy = async () => {
    await scrollCopy();
  };
  const onSave = async () => {
    await scrollSave();
  };

  if (!parsed) return null;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "auto",
        background: "rgba(20,20,20,0.94)",
        color: "white",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        overflow: "hidden",
        position: "relative",
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
              userSelect: "none",
            }}
          />
        ) : (
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>
            {finalized ? "Done" : "Scroll the window below to capture…"}
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
        {finalized ? (
          <>
            <span style={{ opacity: 0.9 }}>
              {finalized.width}×{finalized.height}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onCopy}
                style={{ ...BTN_BASE, background: "#60a5fa", color: "white" }}
              >
                Copy
              </button>
              <button
                type="button"
                onClick={onSave}
                style={{ ...BTN_BASE, background: "#4ade80", color: "#0a2a17" }}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <span style={{ opacity: 0.85, fontVariantNumeric: "tabular-nums" }}>
              {progress?.frames ?? 0} frames · {progress?.height ?? 0}px
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onDone}
                style={{ ...BTN_BASE, background: "#60a5fa", color: "white" }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={onCancel}
                style={{ ...BTN_BASE, background: "rgba(255,255,255,0.12)", color: "white" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
