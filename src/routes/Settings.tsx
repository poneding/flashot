import { TooltipBubble } from "@/annotation/Tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UtilityWindowShell } from "@/components/UtilityWindowShell";
import { createTranslator, resolveLocale } from "@/i18n";
import { applyAccentColor, SELECTION_COLOR } from "@/lib/colors";
import { chooseDefaultSaveDir, getSettings, setSettings } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import { AccentColorSelect } from "@/settings/AccentColorSelect";
import { HotkeyRecorder } from "@/settings/HotkeyRecorder";
import { LanguageSelect } from "@/settings/LanguageSelect";
import { SettingsSection } from "@/settings/SettingsSection";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { applyThemePreference } from "@/settings/useStoredAccentColor";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AppWindowIcon,
  CropIcon,
  FolderOpenIcon,
  InfoIcon,
  MonitorIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type ShortcutSettingKey = "captureHotkey" | "fullscreenHotkey" | "activeWindowHotkey";

function platformModifier(platform = navigator.platform) {
  return /Mac|iPhone|iPad|iPod/.test(platform) ? "Cmd" : "Ctrl";
}

function quickShotModifier(platform = navigator.platform) {
  if (/Mac|iPhone|iPad|iPod/.test(platform)) return "Option";
  if (/Win/.test(platform)) return "Win";
  return "Super";
}

function storedThemePreference(): Settings["theme"] | null {
  try {
    const theme = window.localStorage.getItem("theme");
    return theme === "dark" || theme === "light" || theme === "system" ? theme : null;
  } catch {
    return null;
  }
}

function defaultSettings(): Settings {
  const mod = platformModifier();
  const quickShotMod = quickShotModifier();
  return {
    captureHotkey: `${mod}+Shift+A`,
    fullscreenHotkey: `${quickShotMod}+F`,
    activeWindowHotkey: `${quickShotMod}+W`,
    theme: "system",
    accentColor: SELECTION_COLOR,
    language: "en",
    launchAtLogin: false,
    autoCheckUpdates: false,
    allowBetaUpdates: false,
    updateCheckIntervalHours: 24,
    lastUpdateCheckAt: null,
    defaultSaveDir: "~/Pictures/Flashot",
    lastSaveDir: null,
    cornerRadius: 0,
  };
}

function initialSettings(): Settings {
  return {
    ...defaultSettings(),
    theme: storedThemePreference() ?? "system",
  };
}

function normalizeUpdateCheckIntervalHours(value: number): number {
  if (!Number.isFinite(value)) return 24;
  return Math.min(168, Math.max(1, Math.round(value)));
}

function ShortcutLabel({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
      <Icon size={14} strokeWidth={1.55} aria-hidden="true" />
      <span className="truncate">{children}</span>
    </label>
  );
}

function ShortcutConflictIndicator({ message }: { message: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  return (
    <span
      ref={anchorRef}
      data-shortcut-conflict
      tabIndex={0}
      role="img"
      aria-label={message}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-red-500 outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <InfoIcon size={16} strokeWidth={1.8} aria-hidden="true" />
      {tooltipVisible && <TooltipBubble label={message} anchorRef={anchorRef} placement="right" />}
    </span>
  );
}

function shortcutConflictLabels(
  shortcuts: Array<{ key: ShortcutSettingKey; label: string; value: string }>,
): Partial<Record<ShortcutSettingKey, string[]>> {
  const buckets = new Map<string, Array<{ key: ShortcutSettingKey; label: string }>>();
  for (const shortcut of shortcuts) {
    const normalized = normalizeHotkeyForConflict(shortcut.value);
    if (!normalized) continue;
    buckets.set(normalized, [...(buckets.get(normalized) ?? []), shortcut]);
  }

  const conflicts: Partial<Record<ShortcutSettingKey, string[]>> = {};
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (const shortcut of bucket) {
      conflicts[shortcut.key] = bucket
        .filter((other) => other.key !== shortcut.key)
        .map((other) => other.label);
    }
  }
  return conflicts;
}

function normalizeHotkeyForConflict(value: string, platform = navigator.platform): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isApple = /Mac|iPhone|iPad|iPod/.test(platform);
  const modifiers = new Set<string>();
  let key: string | null = null;

  for (const rawPart of trimmed.split("+").map((part) => part.trim()).filter(Boolean)) {
    switch (rawPart.toLowerCase()) {
      case "commandorcontrol":
        modifiers.add(isApple ? "super" : "ctrl");
        break;
      case "cmd":
      case "command":
      case "meta":
      case "super":
      case "win":
      case "windows":
        modifiers.add("super");
        break;
      case "ctrl":
      case "control":
        modifiers.add("ctrl");
        break;
      case "alt":
      case "option":
        modifiers.add("alt");
        break;
      case "shift":
        modifiers.add("shift");
        break;
      default:
        key = rawPart.length === 1 ? rawPart.toUpperCase() : rawPart.toUpperCase();
        break;
    }
  }

  if (!key) return null;
  const modifierOrder = ["super", "ctrl", "alt", "shift"];
  return [...modifierOrder.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

export function SettingsRoute() {
  const [s, setS] = useState<Settings>(() => initialSettings());
  const [saved, setSaved] = useState(false);
  const t = createTranslator(resolveLocale(s.language));
  const windowTitle = t("settings.title");
  const shortcutRows: Array<{
    key: ShortcutSettingKey;
    icon: LucideIcon;
    label: string;
    onChange: (value: string) => void;
  }> = [
      {
        key: "captureHotkey",
        icon: CropIcon,
        label: t("settings.shortcut.region"),
        onChange: (captureHotkey) => setS({ ...s, captureHotkey }),
      },
      {
        key: "fullscreenHotkey",
        icon: MonitorIcon,
        label: t("settings.shortcut.screen"),
        onChange: (fullscreenHotkey) => setS({ ...s, fullscreenHotkey }),
      },
      {
        key: "activeWindowHotkey",
        icon: AppWindowIcon,
        label: t("settings.shortcut.window"),
        onChange: (activeWindowHotkey) => setS({ ...s, activeWindowHotkey }),
      },
    ];
  const conflicts = shortcutConflictLabels(
    shortcutRows.map((row) => ({
      key: row.key,
      label: row.label,
      value: s[row.key],
    })),
  );

  useEffect(() => {
    getSettings()
      .then((settings) => setS({
        ...defaultSettings(),
        ...settings,
        language: resolveLocale(settings.language),
      }))
      .catch(() => { });
  }, []);

  useEffect(() => {
    applyThemePreference(s.theme);
  }, [s.theme]);

  useEffect(() => {
    applyAccentColor(s.accentColor);
  }, [s.accentColor]);

  useEffect(() => {
    document.title = windowTitle;
    try {
      getCurrentWindow().setTitle(windowTitle).catch(() => { });
    } catch {
      // The route can be previewed in a plain browser where Tauri window APIs are absent.
    }
  }, [windowTitle]);

  const save = async () => {
    await setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const changeDefaultSaveDir = async () => {
    const dir = await chooseDefaultSaveDir(s.defaultSaveDir);
    if (dir) {
      setS((current) => ({ ...current, defaultSaveDir: dir }));
    }
  };

  const setAutoCheckUpdates = (autoCheckUpdates: boolean) => {
    setS((current) => ({
      ...current,
      autoCheckUpdates,
      allowBetaUpdates: autoCheckUpdates ? current.allowBetaUpdates : false,
    }));
  };

  return (
    <UtilityWindowShell windowName="settings" contentClassName="max-w-lg h-full flex flex-col">
      <Tabs defaultValue="general" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList className="grid w-full grid-cols-3 shrink-0">
          <TabsTrigger value="general">{t("settings.general.title")}</TabsTrigger>
          <TabsTrigger value="appearance">{t("settings.appearance.title")}</TabsTrigger>
          <TabsTrigger value="shortcuts">{t("settings.shortcuts.title")}</TabsTrigger>
        </TabsList>

        <div className="flex-1 mt-4 overflow-y-auto min-h-0">
          <TabsContent value="general" className="space-y-5 m-0">
            <SettingsSection title={t("settings.general.title")}>
              <div
                data-default-save-row
                className="flex min-h-9 items-center justify-between gap-3"
              >
                <label className="shrink-0 text-sm font-medium" htmlFor="default-save-dir">
                  {t("settings.defaultSaveDir.label")}
                </label>
                <div data-default-save-field className="relative min-w-0 flex-1">
                  <input
                    aria-label={t("settings.defaultSaveDir.label")}
                    disabled
                    id="default-save-dir"
                    readOnly
                    className="h-8 w-full rounded-md border border-input bg-muted/30 pl-2.5 pr-8 font-mono text-xs text-muted-foreground opacity-100 outline-none disabled:cursor-default disabled:opacity-100"
                    title={s.defaultSaveDir}
                    type="text"
                    value={s.defaultSaveDir}
                  />
                  <Button
                    aria-label={t("settings.defaultSaveDir.change")}
                    type="button"
                    title={t("settings.defaultSaveDir.change")}
                    variant="ghost"
                    size="icon-xs"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={changeDefaultSaveDir}
                  >
                    <FolderOpenIcon size={15} strokeWidth={1.7} aria-hidden="true" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="launch-at-login"
                  aria-label={t("settings.launchAtLogin.label")}
                  checked={s.launchAtLogin}
                  onCheckedChange={(launchAtLogin) => setS({ ...s, launchAtLogin })}
                />
                <label className="text-sm font-medium" htmlFor="launch-at-login">{t("settings.launchAtLogin.label")}</label>
              </div>

              <div className="flex min-h-9 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id="auto-check-updates"
                    aria-label={t("settings.autoCheckUpdates.label")}
                    checked={s.autoCheckUpdates}
                    onCheckedChange={setAutoCheckUpdates}
                  />
                  <label className="truncate text-sm font-medium" htmlFor="auto-check-updates">{t("settings.autoCheckUpdates.label")}</label>
                </div>
                {s.autoCheckUpdates && (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>{t("settings.updateCheckInterval.prefix")}</span>
                    <input
                      aria-label={t("settings.updateCheckInterval.inputLabel")}
                      className="h-6 w-12 rounded-md border border-input bg-background px-1 text-center text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      max={168}
                      min={1}
                      onChange={(event) => setS({
                        ...s,
                        updateCheckIntervalHours: normalizeUpdateCheckIntervalHours(Number(event.currentTarget.value)),
                      })}
                      step={1}
                      type="number"
                      value={s.updateCheckIntervalHours}
                    />
                    <span>{t("settings.updateCheckInterval.suffix")}</span>
                  </label>
                )}
              </div>

              {s.autoCheckUpdates && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="allow-beta-updates"
                    aria-label={t("settings.allowBetaUpdates.label")}
                    checked={s.allowBetaUpdates}
                    onCheckedChange={(allowBetaUpdates) => setS({ ...s, allowBetaUpdates })}
                  />
                  <label className="text-sm font-medium" htmlFor="allow-beta-updates">{t("settings.allowBetaUpdates.label")}</label>
                </div>
              )}
            </SettingsSection>
          </TabsContent>

          <TabsContent value="appearance" className="space-y-5 m-0">
            <SettingsSection title={t("settings.appearance.title")}>
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="settings-language">{t("settings.language.label")}</label>
                <LanguageSelect
                  value={s.language}
                  onChange={(language) => setS({ ...s, language })}
                  ariaLabel={t("settings.language.label")}
                  labels={{
                    en: t("settings.language.en"),
                    "zh-CN": t("settings.language.zh-CN"),
                    "zh-TW": t("settings.language.zh-TW"),
                  }}
                />
              </div>

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
                  ariaLabel={t("settings.accentColor.label")}
                  optionLabel={(name) => t("settings.accentColor.option", { name })}
                  colorNames={{
                    cyan: t("settings.accentColor.cyan"),
                    rose: t("settings.accentColor.rose"),
                    amber: t("settings.accentColor.amber"),
                    emerald: t("settings.accentColor.emerald"),
                    violet: t("settings.accentColor.violet"),
                  }}
                />
              </div>

            </SettingsSection>
          </TabsContent>

          <TabsContent value="shortcuts" className="space-y-5 m-0">
            <SettingsSection title={t("settings.shortcuts.title")}>
              <div className="space-y-3">
                {shortcutRows.map((row) => {
                  const conflictLabels = conflicts[row.key];
                  const conflictMessage = conflictLabels?.length
                    ? t("settings.hotkey.conflict", {
                      label: row.label,
                      other: conflictLabels.join(", "),
                    })
                    : null;
                  return (
                    <div
                      key={row.key}
                      data-shortcut-row={row.key}
                      className="flex min-h-9 items-center justify-between gap-3"
                    >
                      <ShortcutLabel icon={row.icon}>{row.label}</ShortcutLabel>
                      <div className="flex shrink-0 items-center gap-2">
                        <HotkeyRecorder
                          value={s[row.key]}
                          onChange={row.onChange}
                          changeLabel={t("settings.hotkey.change")}
                          clearLabel={t("settings.hotkey.clear", { label: row.label })}
                          inputLabel={t("settings.hotkey.inputLabel", { label: row.label })}
                          recordingLabel={t("settings.hotkey.recording")}
                        />
                        {conflictMessage ? <ShortcutConflictIndicator message={conflictMessage} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsSection>
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex justify-end gap-2 pt-4 mt-auto border-t">
        <Button variant="outline" onClick={() => setS(defaultSettings())}>{t("settings.reset")}</Button>
        <Button onClick={save}>{saved ? t("settings.saved") : t("settings.save")}</Button>
      </div>
    </UtilityWindowShell>
  );
}
