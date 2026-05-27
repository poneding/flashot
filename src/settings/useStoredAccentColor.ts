import { useEffect } from "react";

import { applyAccentColor } from "@/lib/colors";
import { getSettings, onSettingsChanged } from "@/lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

export function useStoredAccentColor() {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const syncColor = () => {
      getSettings()
        .then((settings) => {
          if (!cancelled) applyAccentColor(settings.accentColor);
        })
        .catch(() => { });
    };

    syncColor();
    onSettingsChanged(syncColor).then((fn) => { unlisten = fn; }).catch(() => { });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
