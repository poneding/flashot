import { useEffect } from "react";

import { applyAccentColor } from "@/lib/colors";
import { getSettings } from "@/lib/ipc";

export function useStoredAccentColor() {
  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((settings) => {
        if (!cancelled) applyAccentColor(settings.accentColor);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);
}
