import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface UpdateInfo {
  version: string;
  body: string | null | undefined;
  date: string | null | undefined;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface UpdateCheckOptions {
  allowBeta?: boolean;
}

const UPDATER_PROGRESS_EVENT = "updater:progress";

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateInfo | null> {
  return await invoke<UpdateInfo | null>("check_for_update", {
    allowBeta: options.allowBeta ?? false,
  });
}

export async function downloadAndInstall(
  onProgress?: (progress: UpdateProgress) => void,
  options: UpdateCheckOptions = {},
): Promise<void> {
  let unlisten: UnlistenFn | null = null;

  if (onProgress) {
    onProgress({ downloaded: 0, total: null });
    unlisten = await listen<UpdateProgress>(UPDATER_PROGRESS_EVENT, (event) => {
      onProgress(event.payload);
    });
  }

  try {
    await invoke("download_and_install_update", {
      allowBeta: options.allowBeta ?? false,
    });
  } finally {
    unlisten?.();
  }
}
