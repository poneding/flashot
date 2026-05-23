import { useEffect, useState } from "react";
import type { ScrollProgress } from "@/lib/types";
import { onScrollMatchFailed, onScrollProgress, scrollCopy, scrollSave, stopScrollSession } from "@/lib/ipc";

// Parses `#/scroll-chrome/{monitorId}` from window.location.hash, mirroring
// the manual route parsing used by Pin.tsx (no react-router dependency).
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
        background: "transparent",
        position: "relative",
      }}
    >
      {toast && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            right: 8,
            background: "rgba(220, 38, 38, 0.92)",
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
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {progress?.previewDataUrl && (
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
        )}
      </div>
      <div
        style={{
          padding: "8px 12px",
          background: "rgba(20,20,20,0.92)",
          color: "white",
          fontSize: 13,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {finalized ? (
          <>
            <span>
              {finalized.width}x{finalized.height}
            </span>
            <button type="button" onClick={onCopy}>
              Copy
            </button>
            <button type="button" onClick={onSave}>
              Save
            </button>
          </>
        ) : (
          <>
            <span>
              Stitching - {progress?.frames ?? 0} frames - {progress?.height ?? 0}px
            </span>
            <button type="button" onClick={onDone}>
              Done
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
