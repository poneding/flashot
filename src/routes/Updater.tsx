import { useEffect, useState, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleCheckIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  XCircleIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkForUpdate, downloadAndInstall, type UpdateInfo, type UpdateProgress } from "@/lib/updater";
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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [errorMsg, setErrorMsg] = useState("");
  const [version, setVersion] = useState("");

  const doCheck = useCallback(async () => {
    setState("checking");
    setErrorMsg("");
    try {
      const info = await checkForUpdate();
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

  const handleDownload = async () => {
    setState("downloading");
    try {
      await downloadAndInstall((p) => setProgress(p));
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

  return (
    <main className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center select-none">
      <img
        src="/app-logo.svg"
        alt="Flashot"
        className="size-12"
        draggable={false}
      />
      {state === "checking" && (
        <>
          <LoaderCircleIcon size={36} className="animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Checking for updates…</p>
        </>
      )}

      {state === "up-to-date" && (
        <>
          <CircleCheckIcon size={36} className="text-green-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">You're up to date</p>
            <p className="text-sm text-muted-foreground">Version {version}</p>
          </div>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </>
      )}

      {state === "available" && updateInfo && (
        <>
          <ArrowUpCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">A new version is available</p>
            <p className="text-sm text-muted-foreground">v{updateInfo.version}</p>
          </div>
          {updateInfo.body && (
            <div className="max-h-[100px] w-full overflow-y-auto rounded-md bg-muted/50 p-3 text-left text-xs text-muted-foreground">
              {updateInfo.body}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Later
            </Button>
            <Button onClick={handleDownload}>Download &amp; Install</Button>
          </div>
        </>
      )}

      {state === "downloading" && (
        <>
          <ArrowDownCircleIcon size={36} className="text-blue-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Downloading…</p>
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
            <p className="text-base font-semibold">Ready to restart</p>
            <p className="text-sm text-muted-foreground">Restart to finish updating</p>
          </div>
          <Button onClick={handleRestart}>Restart Now</Button>
        </>
      )}

      {state === "error" && (
        <>
          <XCircleIcon size={36} className="text-red-500" />
          <div className="space-y-1">
            <p className="text-base font-semibold">Update check failed</p>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={doCheck}>
              Retry
            </Button>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
