import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CircleCheckIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  XCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UtilityWindowShell } from "@/components/UtilityWindowShell";
import { createTranslator } from "@/i18n";
import { useStoredAppearance, useStoredLanguage } from "@/settings/useStoredAccentColor";
import { checkForUpdate, downloadAndInstall, type UpdateInfo, type UpdateProgress } from "@/lib/updater";
import { getSettings } from "@/lib/ipc";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdaterState =
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "restart"
  | "error";

export function UpdaterRoute() {
  const [state, setState] = useState<UpdaterState>("checking");
  useStoredAppearance();
  const t = createTranslator(useStoredLanguage());
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [errorMsg, setErrorMsg] = useState("");
  const [version, setVersion] = useState("");
  const [allowBetaUpdates, setAllowBetaUpdates] = useState(false);

  const doCheck = useCallback(async () => {
    setState("checking");
    setErrorMsg("");
    try {
      const settings = await getSettings().catch(() => null);
      const allowBeta = settings?.allowBetaUpdates ?? false;
      setAllowBetaUpdates(allowBeta);

      const info = await checkForUpdate({ allowBeta });
      if (info) {
        setUpdateInfo(info);
        setState("available");
      } else {
        setState("up-to-date");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("unknown"));
    doCheck();
  }, [doCheck]);

  // Auto-resize window when update is available with release notes
  useEffect(() => {
    if (state === "available" && updateInfo?.body) {
      getCurrentWindow().setSize(new LogicalSize(360, 420));
    }
  }, [state, updateInfo]);

  const handleDownload = async () => {
    setState("downloading");
    try {
      await downloadAndInstall((p) => setProgress(p), { allowBeta: allowBetaUpdates });
      setState("restart");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const handleRestart = () => {
    relaunch();
  };

  const betaStatus = t(allowBetaUpdates ? "updater.betaAllowed" : "updater.betaBlocked");
  const showBetaStatus = state !== "checking";

  return (
    <UtilityWindowShell
      windowName="updater"
      contentClassName="flex flex-col items-center justify-center gap-4 text-center select-none"
    >
      <img
        src="/app-logo.svg"
        alt="Flashot"
        className="size-12"
        draggable={false}
      />
      {showBetaStatus && (
        <p className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {betaStatus}
        </p>
      )}
      {state === "checking" && (
        <>
          <LoaderCircleIcon size={36} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("updater.checking")}</p>
        </>
      )}

      {state === "up-to-date" && (
        <>
          <CircleCheckIcon size={36} className="text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t("updater.upToDate")}</p>
            <p className="text-sm text-muted-foreground">{t("updater.version", { version })}</p>
          </div>
          <Button variant="outline" onClick={handleClose}>
            {t("updater.close")}
          </Button>
        </>
      )}

      {state === "available" && updateInfo && (
        <>
          <ArrowUpCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t("updater.available")}</p>
            <p className="text-sm text-muted-foreground">v{updateInfo.version}</p>
          </div>
          {updateInfo.body && (
            <div className="max-h-[160px] w-full overflow-y-auto rounded-md bg-muted/50 p-3 text-left text-xs text-muted-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="mb-2 text-sm font-semibold text-foreground">{children}</h1>,
                  h2: ({ children }) => <h2 className="mb-2 text-sm font-semibold text-foreground">{children}</h2>,
                  h3: ({ children }) => <h3 className="mb-1.5 text-xs font-semibold text-foreground">{children}</h3>,
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
                  li: ({ children }) => <li className="pl-0.5">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  code: ({ children }) => <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>,
                  a: ({ children, href }) => (
                    <a
                      className="font-medium text-primary underline-offset-2 hover:underline"
                      href={href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {updateInfo.body}
              </ReactMarkdown>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              {t("updater.later")}
            </Button>
            <Button onClick={handleDownload}>{t("updater.downloadInstall")}</Button>
          </div>
        </>
      )}

      {state === "downloading" && (
        <>
          <ArrowDownCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t("updater.downloading")}</p>
          </div>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted">
            {progress.total ? (
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                style={{ width: `${Math.round((progress.downloaded / progress.total) * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
            )}
          </div>
          {progress.total && (
            <p className="text-xs text-muted-foreground">
              {Math.round((progress.downloaded / progress.total) * 100)}%
            </p>
          )}
        </>
      )}

      {state === "restart" && (
        <>
          <CircleCheckIcon size={36} className="text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t("updater.readyRestart")}</p>
            <p className="text-sm text-muted-foreground">{t("updater.restartDescription")}</p>
          </div>
          <Button onClick={handleRestart}>{t("updater.restartNow")}</Button>
        </>
      )}

      {state === "error" && (
        <>
          <XCircleIcon size={36} className="text-red-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">{t("updater.error")}</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={doCheck}>
              {t("updater.retry")}
            </Button>
            <Button variant="outline" onClick={handleClose}>
              {t("updater.close")}
            </Button>
          </div>
        </>
      )}
    </UtilityWindowShell>
  );
}
