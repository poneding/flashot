import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ocr } from "@/lib/ipc";
import type { OcrDownloadProgress, OcrResult, Rect } from "@/lib/types";

type Phase =
  | { kind: "checking" }
  | { kind: "confirming-download"; sizeBytes: number }
  | {
      kind: "downloading";
      progress: number;
      downloadedBytes: number;
      totalBytes: number;
    }
  | { kind: "recognizing" }
  | { kind: "result"; result: OcrResult }
  | { kind: "error"; message: string };

type ParsedRoute = {
  monitorId: number;
  rect: Rect;
  cachedResult: OcrResult | null;
};

function parseOcrChromeRoute(): ParsedRoute | null {
  const h = window.location.hash || "";
  const prefix = "#/ocr-chrome/";
  if (!h.startsWith(prefix)) return null;
  const rest = h.slice(prefix.length);
  const [, queryPart = ""] = rest.split("?");
  const query = queryPart.split("#")[0];
  const params = new URLSearchParams(query);

  const monitorId = Number(params.get("monitorId") ?? "0");
  if (!Number.isFinite(monitorId)) return null;

  let rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  try {
    const rectRaw = params.get("rect");
    if (rectRaw) {
      const parsed = JSON.parse(rectRaw);
      if (
        parsed &&
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        rect = parsed;
      }
    }
  } catch {
    // ignore — falls back to zero rect; recognize will surface a backend error.
  }

  let cachedResult: OcrResult | null = null;
  const cachedKey = params.get("cachedResultKey");
  if (cachedKey) {
    try {
      const raw = sessionStorage.getItem(cachedKey);
      if (raw) cachedResult = JSON.parse(raw) as OcrResult;
    } catch {
      cachedResult = null;
    }
  }

  return { monitorId, rect, cachedResult };
}

const FALLBACK_TOTAL_BYTES = 15_000_000;

export function OcrChromeRoute() {
  const [parsed] = useState(() => parseOcrChromeRoute());
  if (!parsed) return null;
  return (
    <OcrChrome
      monitorId={parsed.monitorId}
      rect={parsed.rect}
      cachedResult={parsed.cachedResult}
    />
  );
}

type Props = {
  monitorId: number;
  rect: Rect;
  cachedResult: OcrResult | null;
};

function OcrChrome({ monitorId, rect, cachedResult }: Props) {
  const [phase, setPhase] = useState<Phase>(
    cachedResult
      ? { kind: "result", result: cachedResult }
      : { kind: "checking" },
  );
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runRecognize = useCallback(async () => {
    setPhase({ kind: "recognizing" });
    try {
      const result = await ocr.recognize(monitorId, rect);
      await emit("ocr:result-cached", result);
      setPhase({ kind: "result", result });
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  }, [monitorId, rect]);

  // Register with WindowMgr so SessionGuard can clean us up. Best-effort.
  useEffect(() => {
    ocr.registerChrome().catch(() => {
      /* best-effort */
    });
  }, []);

  // Initial flow: check install → confirm OR recognize.
  useEffect(() => {
    if (cachedResult) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await ocr.status();
        if (cancelled) return;
        if (status.kind === "installed") {
          await runRecognize();
        } else {
          setPhase({
            kind: "confirming-download",
            sizeBytes: FALLBACK_TOTAL_BYTES,
          });
        }
      } catch (e) {
        if (!cancelled) setPhase({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cachedResult, runRecognize]);

  // Listen for download progress.
  useEffect(() => {
    const sub = ocr.onDownloadProgress((p: OcrDownloadProgress) => {
      setPhase((cur) =>
        cur.kind === "downloading"
          ? {
              kind: "downloading",
              progress: p.progress,
              downloadedBytes: p.downloaded_bytes,
              totalBytes: p.total_bytes,
            }
          : cur,
      );
    });
    return () => {
      sub.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  // Auto-focus + select textarea on result.
  useEffect(() => {
    if (phase.kind === "result" && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [phase.kind]);

  const onCopy = useCallback(async (text: string) => {
    try {
      await writeText(text);
      setCopyToast("Copied");
      window.setTimeout(() => setCopyToast(null), 1500);
    } catch (e) {
      setCopyToast(`Copy failed: ${errorMessage(e)}`);
      window.setTimeout(() => setCopyToast(null), 2500);
    }
  }, []);

  const onSave = useCallback(async (text: string) => {
    try {
      await ocr.saveText(text);
    } catch (e) {
      setCopyToast(`Save failed: ${errorMessage(e)}`);
      window.setTimeout(() => setCopyToast(null), 2500);
    }
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        e.preventDefault();
        await getCurrentWindow().close();
        return;
      }
      if (phase.kind !== "result") return;
      if (meta && e.key.toLowerCase() === "c") {
        e.preventDefault();
        await onCopy(phase.result.full_text);
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        await onSave(phase.result.full_text);
      } else if (meta && e.key === "Enter") {
        e.preventDefault();
        await onCopy(phase.result.full_text);
        await getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onCopy, onSave]);

  async function onConfirmDownload() {
    setPhase({
      kind: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: FALLBACK_TOTAL_BYTES,
    });
    try {
      await ocr.install();
      await runRecognize();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  }

  return (
    <div className="ocr-chrome">
      <header className="ocr-chrome__header">
        <span className="ocr-chrome__title">Extracted text</span>
        {phase.kind === "result" && (
          <span className="ocr-chrome__elapsed">
            {phase.result.elapsed_ms} ms
          </span>
        )}
        <button
          type="button"
          className="ocr-chrome__close"
          onClick={() => getCurrentWindow().close()}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className="ocr-chrome__body">
        {phase.kind === "checking" && <Spinner label="Checking…" />}
        {phase.kind === "confirming-download" && (
          <ConfirmPanel
            sizeBytes={phase.sizeBytes}
            onConfirm={onConfirmDownload}
            onCancel={() => getCurrentWindow().close()}
          />
        )}
        {phase.kind === "downloading" && (
          <DownloadPanel
            progress={phase.progress}
            downloadedBytes={phase.downloadedBytes}
            totalBytes={phase.totalBytes}
          />
        )}
        {phase.kind === "recognizing" && <Spinner label="Recognizing…" />}
        {phase.kind === "result" && (
          <textarea
            ref={textareaRef}
            className="ocr-chrome__textarea"
            defaultValue={phase.result.full_text}
            spellCheck={false}
          />
        )}
        {phase.kind === "error" && (
          <ErrorPanel message={phase.message} onRetry={runRecognize} />
        )}
      </div>

      {phase.kind === "result" && (
        <footer className="ocr-chrome__footer">
          {copyToast && (
            <span className="ocr-chrome__toast" role="status">
              {copyToast}
            </span>
          )}
          <button
            type="button"
            className="ocr-chrome__button ocr-chrome__button--primary"
            onClick={() => onCopy(phase.result.full_text)}
          >
            Copy
          </button>
          <button
            type="button"
            className="ocr-chrome__button"
            onClick={() => onSave(phase.result.full_text)}
          >
            Save as .txt
          </button>
        </footer>
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="ocr-spinner" role="status" aria-live="polite">
      {label}
    </div>
  );
}

function ConfirmPanel({
  sizeBytes,
  onConfirm,
  onCancel,
}: {
  sizeBytes: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const mb = (sizeBytes / 1_000_000).toFixed(0);
  return (
    <div className="ocr-confirm">
      <p>OCR needs a ~{mb} MB model file. Downloaded once.</p>
      <div className="ocr-confirm__actions">
        <button
          type="button"
          className="ocr-chrome__button ocr-chrome__button--primary"
          onClick={onConfirm}
        >
          Download
        </button>
        <button
          type="button"
          className="ocr-chrome__button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DownloadPanel({
  progress,
  downloadedBytes,
  totalBytes,
}: {
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
}) {
  const done = (downloadedBytes / 1_000_000).toFixed(1);
  const total = (totalBytes / 1_000_000).toFixed(1);
  const pct = Math.min(100, Math.max(0, progress * 100));
  return (
    <div className="ocr-download">
      <div
        className="ocr-download__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className="ocr-download__fill"
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
      <p>
        {done} / {total} MB
      </p>
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="ocr-error">
      <p>{message}</p>
      <button
        type="button"
        className="ocr-chrome__button ocr-chrome__button--primary"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
