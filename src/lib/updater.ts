import { check } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  body: string | undefined;
  date: string | undefined;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    body: update.body,
    date: update.date,
  };
}

export async function downloadAndInstall(
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  const update = await check();
  if (!update) return;

  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress?.({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        break;
    }
  });
}
