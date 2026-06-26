import { useEffect, useState } from "react";

import { resolveLocale, type Locale } from "@/i18n";
import { applyAccentColor } from "@/lib/colors";
import { getSettings, onSettingsChanged } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

function systemPrefersDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

async function resolveSystemThemeDark(): Promise<boolean> {
  try {
    const nativeTheme = await getCurrentWindow().theme();
    if (nativeTheme === "dark") return true;
    if (nativeTheme === "light") return false;
  } catch {
    // Non-Tauri environments (tests, browser preview) fall back to matchMedia.
  }
  return systemPrefersDark();
}

function applyDocumentTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export async function applySystemThemePreference() {
  applyDocumentTheme(await resolveSystemThemeDark());
  try {
    window.localStorage.setItem("theme", "system");
  } catch {
    // Ignore storage failures; the document class is the source of truth.
  }
}

export function applyThemePreference(theme: Settings["theme"]) {
  if (theme === "system") {
    void applySystemThemePreference();
    return;
  }

  applyDocumentTheme(theme === "dark");

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

export function useThemePreference(theme: Settings["theme"]) {
  useEffect(() => {
    applyThemePreference(theme);

    if (theme !== "system") return;

    const resyncSystemTheme = () => {
      void applySystemThemePreference();
    };

    let media: MediaQueryList | undefined;
    if (typeof window.matchMedia === "function") {
      media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", resyncSystemTheme);
    }

    let unlistenTheme: UnlistenFn | undefined;
    void (async () => {
      try {
        const window = getCurrentWindow();
        if (typeof window.onThemeChanged !== "function") return;
        unlistenTheme = await window.onThemeChanged(resyncSystemTheme);
      } catch {
        // Ignore non-Tauri environments and partial test mocks.
      }
    })();

    return () => {
      media?.removeEventListener("change", resyncSystemTheme);
      unlistenTheme?.();
    };
  }, [theme]);
}

export function useStoredAppearance() {
  const [themePreference, setThemePreference] = useState<Settings["theme"]>("system");

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const syncAppearance = () => {
      getSettings()
        .then((settings) => {
          if (cancelled) return;
          applyAccentColor(settings.accentColor);
          setThemePreference(settings.theme);
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

  useThemePreference(themePreference);
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
