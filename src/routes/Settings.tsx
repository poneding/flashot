import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { UtilityWindowShell } from "@/components/UtilityWindowShell";
import { AccentColorSelect } from "@/settings/AccentColorSelect";
import { HotkeyRecorder } from "@/settings/HotkeyRecorder";
import { LanguageSelect } from "@/settings/LanguageSelect";
import { SettingsSection } from "@/settings/SettingsSection";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { getSettings, setSettings } from "@/lib/ipc";
import { applyAccentColor, SELECTION_COLOR } from "@/lib/colors";
import { createTranslator, resolveLocale } from "@/i18n";
import type { Settings } from "@/lib/types";
import { AppWindowIcon, CropIcon, MonitorIcon, type LucideIcon } from "lucide-react";

function platformModifier() {
  return navigator.platform.includes("Mac") ? "Cmd" : "Ctrl";
}

function defaultSettings(): Settings {
  const mod = platformModifier();
  return {
    captureHotkey: `${mod}+Shift+A`,
    fullscreenHotkey: `${mod}+Shift+F`,
    activeWindowHotkey: `${mod}+Shift+W`,
    theme: "system",
    accentColor: SELECTION_COLOR,
    language: "system",
    launchAtLogin: false,
    lastSaveDir: null,
    cornerRadius: 0,
  };
}

function ShortcutLabel({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <Icon size={14} strokeWidth={1.55} aria-hidden="true" />
      {children}
    </label>
  );
}

export function SettingsRoute() {
  const [s, setS] = useState<Settings>(() => defaultSettings());
  const [saved, setSaved] = useState(false);
  const t = createTranslator(resolveLocale(s.language));

  useEffect(() => {
    getSettings()
      .then((settings) => setS({ ...defaultSettings(), ...settings }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      s.theme === "dark" || (s.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  }, [s.theme]);

  useEffect(() => {
    applyAccentColor(s.accentColor);
  }, [s.accentColor]);

  const save = async () => {
    await setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <UtilityWindowShell windowName="settings" contentClassName="max-w-md space-y-5">
      <h1 className="text-xl font-semibold">{t("settings.title")}</h1>

      <SettingsSection title={t("settings.shortcuts.title")}>
        <div className="space-y-2">
          <ShortcutLabel icon={CropIcon}>{t("settings.shortcut.region")}</ShortcutLabel>
          <HotkeyRecorder
            value={s.captureHotkey}
            onChange={(captureHotkey) => setS({ ...s, captureHotkey })}
            changeLabel={t("settings.hotkey.change")}
            recordingLabel={t("settings.hotkey.recording")}
          />
        </div>

        <div className="space-y-2">
          <ShortcutLabel icon={MonitorIcon}>{t("settings.shortcut.screen")}</ShortcutLabel>
          <HotkeyRecorder
            value={s.fullscreenHotkey}
            onChange={(fullscreenHotkey) => setS({ ...s, fullscreenHotkey })}
            changeLabel={t("settings.hotkey.change")}
            recordingLabel={t("settings.hotkey.recording")}
          />
        </div>

        <div className="space-y-2">
          <ShortcutLabel icon={AppWindowIcon}>{t("settings.shortcut.window")}</ShortcutLabel>
          <HotkeyRecorder
            value={s.activeWindowHotkey}
            onChange={(activeWindowHotkey) => setS({ ...s, activeWindowHotkey })}
            changeLabel={t("settings.hotkey.change")}
            recordingLabel={t("settings.hotkey.recording")}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.capture.title")}>
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium">{t("settings.cornerRadius.label")}</label>
          <span className="text-sm text-muted-foreground">{s.cornerRadius}px</span>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.appearance.title")}>
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium">{t("settings.theme.label")}</label>
          <ThemeSelect
            value={s.theme}
            onChange={(theme) => setS({ ...s, theme })}
            labels={{
              system: t("settings.theme.system"),
              light: t("settings.theme.light"),
              dark: t("settings.theme.dark"),
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium">{t("settings.accentColor.label")}</label>
          <AccentColorSelect
            value={s.accentColor}
            onChange={(accentColor) => setS({ ...s, accentColor })}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium" htmlFor="settings-language">{t("settings.language.label")}</label>
          <LanguageSelect
            value={s.language}
            onChange={(language) => setS({ ...s, language })}
            ariaLabel={t("settings.language.label")}
            labels={{
              system: t("settings.language.system"),
              en: t("settings.language.en"),
              "zh-CN": t("settings.language.zh-CN"),
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.general.title")}>
        <div className="flex items-center gap-2">
          <Checkbox
            id="launch-at-login"
            aria-label={t("settings.launchAtLogin.label")}
            checked={s.launchAtLogin}
            onCheckedChange={(launchAtLogin) => setS({ ...s, launchAtLogin })}
          />
          <label className="text-sm font-medium" htmlFor="launch-at-login">{t("settings.launchAtLogin.label")}</label>
        </div>
      </SettingsSection>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => setS(defaultSettings())}>{t("settings.reset")}</Button>
        <Button onClick={save}>{saved ? t("settings.saved") : t("settings.save")}</Button>
      </div>
    </UtilityWindowShell>
  );
}
