import { useEffect, useState } from "react";

import { resolveLocale, type Locale } from "@/i18n";
import { applyAccentColor } from "@/lib/colors";
import { getSettings, onSettingsChanged } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import type { UnlistenFn } from "@tauri-apps/api/event";

function systemPrefersDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function applyThemePreference(theme: Settings["theme"]) {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark());

  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";

  try {
    window.localStorage.setItem("theme", theme);
  } catch {
    // Ignore storage failures; the document class is the source of truth.
  }
}

export function applyStoredAppearance(settings: Pick<Settings, "accentColor" | "theme">) {
  applyAccentColor(settings.accentColor);
  applyThemePreference(settings.theme);
}

export function useStoredAppearance() {
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const syncAppearance = () => {
      getSettings()
        .then((settings) => {
          if (!cancelled) applyStoredAppearance(settings);
        })
        .catch(() => { });
    };

    syncAppearance();
    onSettingsChanged(syncAppearance).then((fn) => { unlisten = fn; }).catch(() => { });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}

export function useStoredAccentColor() {
  useStoredAppearance();
}

export function useStoredLanguage(defaultLocale: Locale = "en"): Locale {
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const syncLanguage = () => {
      Promise.resolve()
        .then(() => getSettings())
        .then((settings) => {
          if (!cancelled) setLocale(resolveLocale(settings?.language));
        })
        .catch(() => { });
    };

    syncLanguage();
    Promise.resolve()
      .then(() => onSettingsChanged(syncLanguage))
      .then((fn) => { unlisten = fn; })
      .catch(() => { });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return locale;
}
