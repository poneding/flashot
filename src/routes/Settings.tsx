import { TooltipBubble } from "@/annotation/Tooltip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UtilityWindowShell } from "@/components/UtilityWindowShell";
import { createTranslator, resolveLocale } from "@/i18n";
import { applyAccentColor, SELECTION_COLOR } from "@/lib/colors";
import { chooseDefaultSaveDir, getSettings, setSettings } from "@/lib/ipc";
import type { Settings } from "@/lib/types";
import { checkForUpdate, downloadAndInstall, type UpdateInfo, type UpdateProgress } from "@/lib/updater";
import { AccentColorSelect } from "@/settings/AccentColorSelect";
import { HotkeyRecorder } from "@/settings/HotkeyRecorder";
import { LanguageSelect } from "@/settings/LanguageSelect";
import { SettingsSection } from "@/settings/SettingsSection";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { useThemePreference } from "@/settings/useStoredAccentColor";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { open } from "@tauri-apps/plugin-shell";
import {
  AppWindowIcon,
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  CircleCheckIcon,
  CropIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
  MonitorIcon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ShortcutSettingKey = "captureHotkey" | "fullscreenHotkey" | "activeWindowHotkey";
type FlashotTab = "general" | "appearance" | "shortcuts" | "updates" | "about";
type UpdaterState =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "restart"
  | "error";

const REPO_URL = "https://github.com/poneding/flashot";
const AUTHOR_URL = "https://github.com/poneding";
const infoFieldClassName = "font-mono text-xs text-muted-foreground";

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

function adaptivePathFieldWidth(value: string): string {
  return `${Math.min(Math.max(value.length + 2, 22), 42)}ch`;
}

function ShortcutLabel({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs font-medium">
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

function tabFromHash(defaultTab: FlashotTab): FlashotTab {
  const hash = window.location.hash;
  if (hash.startsWith("#/about") || hash.startsWith("#/flashot/about")) return "about";
  if (hash.startsWith("#/updater") || hash.startsWith("#/flashot/updates")) return "updates";
  if (hash.startsWith("#/flashot/appearance")) return "appearance";
  if (hash.startsWith("#/flashot/shortcuts")) return "shortcuts";
  if (hash.startsWith("#/settings") || hash.startsWith("#/flashot/general")) return "general";
  return defaultTab;
}

function updateCheckRequestFromHash(): number {
  const hash = window.location.hash;
  if (!hash.startsWith("#/updater") && !hash.startsWith("#/flashot/updates")) return 0;
  const query = hash.split("?")[1] ?? "";
  const params = new URLSearchParams(query);
  if (params.get("check") !== "1") return 0;
  const request = Number(params.get("request"));
  return Number.isFinite(request) && request > 0 ? request : 1;
}

function consumeUpdateCheckRequest() {
  if (updateCheckRequestFromHash() <= 0) return;
  window.history.replaceState(null, "", "#/flashot/updates");
}

function FlashotInfoField({
  children,
  dataAttribute,
}: {
  children: ReactNode;
  dataAttribute?: string;
}) {
  const dataAttrs = dataAttribute ? { [dataAttribute]: true } : {};

  return (
    <p data-flashot-info-field {...dataAttrs} className={infoFieldClassName}>
      {children}
    </p>
  );
}

function FlashotInfoLayout({
  action,
  bodyDataAttribute,
  children,
  iconAlt,
  identityDataAttribute,
  panelDataAttribute,
  selectNone = false,
  fields,
}: {
  action?: ReactNode;
  bodyDataAttribute?: string;
  children?: ReactNode;
  iconAlt: string;
  identityDataAttribute: string;
  panelDataAttribute: string;
  selectNone?: boolean;
  fields: ReactNode;
}) {
  const bodyDataAttrs = bodyDataAttribute ? { [bodyDataAttribute]: true } : {};
  const identityDataAttrs = { [identityDataAttribute]: true };
  const panelDataAttrs = { [panelDataAttribute]: true };

  return (
    <div
      data-flashot-info-panel
      {...panelDataAttrs}
      className={`flex h-full flex-col items-center justify-center gap-3 text-center${selectNone ? " select-none" : ""}`}
    >
      <div
        data-flashot-info-identity
        {...identityDataAttrs}
        className="flex flex-col items-center gap-2"
      >
        <img
          src="/app-logo.svg"
          alt={iconAlt}
          className="size-12 shrink-0"
          draggable={false}
        />
        <h1 className="text-base font-semibold leading-tight">Flashot</h1>
      </div>
      <div
        data-flashot-info-body
        {...bodyDataAttrs}
        className="flex w-full max-w-[260px] flex-col items-center justify-center gap-2"
      >
        <div data-flashot-info-fields className="flex flex-col items-center gap-1">
          {fields}
        </div>
      </div>
      {children}
      {action ? <div data-flashot-info-action>{action}</div> : null}
    </div>
  );
}

function AboutPanel({ language }: { language: Settings["language"] }) {
  const [version, setVersion] = useState<string | null>(null);
  const t = createTranslator(resolveLocale(language));

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  return (
    <FlashotInfoLayout
      action={(
        <Button size="sm" className="min-w-[112px] gap-1.5" onClick={() => open(REPO_URL)}>
          <ExternalLinkIcon aria-hidden="true" size={14} strokeWidth={1.8} />
          {t("about.repository")}
        </Button>
      )}
      bodyDataAttribute="data-about-links"
      iconAlt={t("about.appIconAlt")}
      identityDataAttribute="data-about-identity"
      panelDataAttribute="data-about-panel"
      fields={(
        <>
          <FlashotInfoField dataAttribute="data-about-version">
            {version ? t("about.version", { version }) : t("about.versionUnavailable")}
          </FlashotInfoField>
          <FlashotInfoField dataAttribute="data-about-author">
            <span>{t("about.authorLabel")}</span>{" "}
            <Button
              size="sm"
              variant="link"
              className="h-auto px-0 py-0 align-baseline font-mono text-xs text-muted-foreground hover:text-primary"
              onClick={() => open(AUTHOR_URL)}
            >
              {t("about.author")}
            </Button>
          </FlashotInfoField>
        </>
      )}
    />
  );
}

function UpdaterPanel({
  autoCheckSignal,
  language,
  onAutoCheckConsumed,
}: {
  autoCheckSignal: number;
  language: Settings["language"];
  onAutoCheckConsumed?: () => void;
}) {
  const [state, setState] = useState<UpdaterState>("idle");
  const t = createTranslator(resolveLocale(language));
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress>({ downloaded: 0, total: null });
  const [errorMsg, setErrorMsg] = useState("");
  const [version, setVersion] = useState("");
  const [allowBetaUpdates, setAllowBetaUpdates] = useState(false);
  const lastAutoCheckSignal = useRef(0);

  const doCheck = useCallback(async () => {
    setState("checking");
    setErrorMsg("");
    setUpdateInfo(null);
    setProgress({ downloaded: 0, total: null });
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
    getSettings()
      .then((settings) => setAllowBetaUpdates(settings.allowBetaUpdates))
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (autoCheckSignal <= lastAutoCheckSignal.current) return;
    lastAutoCheckSignal.current = autoCheckSignal;
    consumeUpdateCheckRequest();
    onAutoCheckConsumed?.();
    void doCheck();
  }, [autoCheckSignal, doCheck, onAutoCheckConsumed]);

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

  const handleRestart = () => {
    relaunch();
  };

  const betaStatus = t(allowBetaUpdates ? "updater.betaAllowed" : "updater.betaBlocked");
  const updateAction = (() => {
    if (state === "idle") {
      return <Button size="sm" className="min-w-[112px]" onClick={doCheck}>{t("updater.checkNow")}</Button>;
    }
    if (state === "up-to-date") {
      return <Button size="sm" className="min-w-[112px]" onClick={doCheck}>{t("updater.checkNow")}</Button>;
    }
    if (state === "available" && updateInfo) {
      return <Button size="sm" className="min-w-[112px]" onClick={handleDownload}>{t("updater.downloadInstall")}</Button>;
    }
    if (state === "restart") {
      return <Button size="sm" className="min-w-[112px]" onClick={handleRestart}>{t("updater.restartNow")}</Button>;
    }
    if (state === "error") {
      return <Button size="sm" className="min-w-[112px]" onClick={doCheck}>{t("updater.retry")}</Button>;
    }
    return null;
  })();

  return (
    <FlashotInfoLayout
      action={updateAction}
      iconAlt="Flashot"
      identityDataAttribute="data-updater-identity"
      panelDataAttribute="data-updater-panel"
      selectNone
      fields={(
        <>
          <FlashotInfoField dataAttribute="data-updater-version">
            {version ? t("updater.version", { version }) : t("about.versionUnavailable")}
          </FlashotInfoField>
          <FlashotInfoField dataAttribute="data-updater-channel">
            {betaStatus}
          </FlashotInfoField>
        </>
      )}
    >

      {state === "checking" && (
        <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
          <LoaderCircleIcon size={24} className="shrink-0 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("updater.checking")}</p>
        </div>
      )}

      {state === "up-to-date" && (
        <>
          <div data-updater-result className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
            <CircleCheckIcon size={24} className="shrink-0 text-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("updater.upToDate")}</p>
            </div>
          </div>
        </>
      )}

      {state === "available" && updateInfo && (
        <>
          <div data-updater-result className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
            <ArrowUpCircleIcon size={24} className="shrink-0 text-blue-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("updater.available")}</p>
              <p className="text-xs text-muted-foreground">v{updateInfo.version}</p>
            </div>
          </div>
          {updateInfo.body && (
            <div className="max-h-[220px] w-full overflow-y-auto rounded-md bg-muted/50 p-2.5 text-left text-xs text-muted-foreground">
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
        </>
      )}

      {state === "downloading" && (
        <>
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
            <ArrowDownCircleIcon size={24} className="shrink-0 text-blue-500" />
            <p className="text-sm font-semibold">{t("updater.downloading")}</p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
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
          <div data-updater-result className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
            <CircleCheckIcon size={24} className="shrink-0 text-green-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("updater.readyRestart")}</p>
              <p className="text-xs text-muted-foreground">{t("updater.restartDescription")}</p>
            </div>
          </div>
        </>
      )}

      {state === "error" && (
        <>
          <div data-updater-result className="flex w-full max-w-sm flex-col items-center gap-2 rounded-md bg-muted/40 px-3 py-3">
            <XCircleIcon size={24} className="shrink-0 text-red-500" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("updater.error")}</p>
              <p className="break-words text-xs text-muted-foreground">{errorMsg}</p>
            </div>
          </div>
        </>
      )}
    </FlashotInfoLayout>
  );
}

export function FlashotRoute({ initialTab = "general" }: { initialTab?: FlashotTab }) {
  const [s, setS] = useState<Settings>(() => initialSettings());
  const [activeTab, setActiveTab] = useState<FlashotTab>(() => tabFromHash(initialTab));
  const [updateCheckSignal, setUpdateCheckSignal] = useState(() => updateCheckRequestFromHash());
  const consumeAutoUpdateCheck = useCallback(() => {
    setUpdateCheckSignal(0);
  }, []);
  const t = createTranslator(resolveLocale(s.language));
  const windowTitle = "Flashot";
  const tabTriggerClass = "text-xs data-[active]:border-border data-[active]:text-primary dark:data-[active]:text-primary";
  const commitSettings = (updater: (current: Settings) => Settings) => {
    setS((current) => {
      const next = updater(current);
      void setSettings(next).catch(() => { });
      return next;
    });
  };
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
        onChange: (captureHotkey) => commitSettings((current) => ({ ...current, captureHotkey })),
      },
      {
        key: "fullscreenHotkey",
        icon: MonitorIcon,
        label: t("settings.shortcut.screen"),
        onChange: (fullscreenHotkey) => commitSettings((current) => ({ ...current, fullscreenHotkey })),
      },
      {
        key: "activeWindowHotkey",
        icon: AppWindowIcon,
        label: t("settings.shortcut.window"),
        onChange: (activeWindowHotkey) => commitSettings((current) => ({ ...current, activeWindowHotkey })),
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

  useThemePreference(s.theme);

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

  useEffect(() => {
    const syncTabFromHash = () => {
      setActiveTab(tabFromHash(initialTab));
      const request = updateCheckRequestFromHash();
      if (request > 0) {
        setUpdateCheckSignal(request);
      }
    };
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, [initialTab]);

  const changeDefaultSaveDir = async () => {
    const dir = await chooseDefaultSaveDir(s.defaultSaveDir);
    if (dir) {
      commitSettings((current) => ({ ...current, defaultSaveDir: dir }));
    }
  };

  const setAutoCheckUpdates = (autoCheckUpdates: boolean) => {
    commitSettings((current) => ({
      ...current,
      autoCheckUpdates,
      allowBetaUpdates: autoCheckUpdates ? current.allowBetaUpdates : false,
    }));
  };

  const resetShortcut = (key: ShortcutSettingKey) => {
    const defaults = defaultSettings();
    commitSettings((current) => ({ ...current, [key]: defaults[key] }));
  };

  return (
    <UtilityWindowShell
      windowName="flashot"
      className="overflow-hidden"
      contentClassName="max-w-[500px] h-full flex flex-col"
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as FlashotTab)}
        className="flex-1 flex flex-col min-h-0 gap-0 overflow-hidden"
      >
        <TabsList className="grid !h-7 w-full shrink-0 grid-cols-5 rounded-md p-0.5">
          <TabsTrigger value="general" className={tabTriggerClass}>{t("settings.general.title")}</TabsTrigger>
          <TabsTrigger value="appearance" className={tabTriggerClass}>{t("settings.appearance.title")}</TabsTrigger>
          <TabsTrigger value="shortcuts" className={tabTriggerClass}>{t("settings.shortcuts.title")}</TabsTrigger>
          <TabsTrigger value="updates" className={tabTriggerClass}>{t("flashot.tabs.updates")}</TabsTrigger>
          <TabsTrigger value="about" className={tabTriggerClass}>{t("flashot.tabs.about")}</TabsTrigger>
        </TabsList>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <TabsContent value="general" className="m-0 space-y-3">
            <SettingsSection title={t("settings.general.title")}>
              <div
                data-default-save-row
                className="flex min-h-8 items-center justify-between gap-2"
              >
                <label className="shrink-0 text-xs font-medium" htmlFor="default-save-dir">
                  {t("settings.defaultSaveDir.label")}
                </label>
                <div
                  data-default-save-field
                  className="relative min-w-[180px] max-w-[320px] flex-[1_1_auto]"
                  style={{ width: adaptivePathFieldWidth(s.defaultSaveDir) }}
                >
                  <input
                    aria-label={t("settings.defaultSaveDir.label")}
                    disabled
                    id="default-save-dir"
                    readOnly
                    className="h-7 w-full rounded-md border border-input bg-muted/30 pl-2 pr-8 font-mono text-xs text-muted-foreground opacity-100 outline-none disabled:cursor-default disabled:opacity-100"
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

              <div className="flex min-h-8 items-center gap-2">
                <Checkbox
                  id="launch-at-login"
                  aria-label={t("settings.launchAtLogin.label")}
                  checked={s.launchAtLogin}
                  onCheckedChange={(launchAtLogin) => commitSettings((current) => ({ ...current, launchAtLogin }))}
                />
                <label className="text-xs font-medium" htmlFor="launch-at-login">{t("settings.launchAtLogin.label")}</label>
              </div>

              <div className="flex min-h-8 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id="auto-check-updates"
                    aria-label={t("settings.autoCheckUpdates.label")}
                    checked={s.autoCheckUpdates}
                    onCheckedChange={setAutoCheckUpdates}
                  />
                  <label className="truncate text-xs font-medium" htmlFor="auto-check-updates">{t("settings.autoCheckUpdates.label")}</label>
                </div>
                {s.autoCheckUpdates && (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>{t("settings.updateCheckInterval.prefix")}</span>
                    <input
                      aria-label={t("settings.updateCheckInterval.inputLabel")}
                      className="h-6 w-11 rounded-md border border-input bg-background px-1 text-center text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      max={168}
                      min={1}
                      onChange={(event) => commitSettings((current) => ({
                        ...current,
                        updateCheckIntervalHours: normalizeUpdateCheckIntervalHours(Number(event.currentTarget.value)),
                      }))}
                      step={1}
                      type="number"
                      value={s.updateCheckIntervalHours}
                    />
                    <span>{t("settings.updateCheckInterval.suffix")}</span>
                  </label>
                )}
              </div>

              {s.autoCheckUpdates && (
                <div className="flex min-h-8 items-center gap-2">
                  <Checkbox
                    id="allow-beta-updates"
                    aria-label={t("settings.allowBetaUpdates.label")}
                    checked={s.allowBetaUpdates}
                    onCheckedChange={(allowBetaUpdates) => commitSettings((current) => ({ ...current, allowBetaUpdates }))}
                  />
                  <label className="text-xs font-medium" htmlFor="allow-beta-updates">{t("settings.allowBetaUpdates.label")}</label>
                </div>
              )}
            </SettingsSection>
          </TabsContent>

          <TabsContent value="appearance" className="m-0 space-y-3">
            <SettingsSection title={t("settings.appearance.title")}>
              <div className="flex min-h-8 items-center justify-between gap-2">
                <label className="text-xs font-medium" htmlFor="settings-language">{t("settings.language.label")}</label>
                <LanguageSelect
                  value={s.language}
                  onChange={(language) => commitSettings((current) => ({ ...current, language }))}
                  ariaLabel={t("settings.language.label")}
                  labels={{
                    en: t("settings.language.en"),
                    "zh-CN": t("settings.language.zh-CN"),
                    "zh-TW": t("settings.language.zh-TW"),
                  }}
                />
              </div>

              <div className="flex min-h-8 items-center justify-between gap-2">
                <label className="text-xs font-medium">{t("settings.theme.label")}</label>
                <ThemeSelect
                  value={s.theme}
                  onChange={(theme) => commitSettings((current) => ({ ...current, theme }))}
                  labels={{
                    system: t("settings.theme.system"),
                    light: t("settings.theme.light"),
                    dark: t("settings.theme.dark"),
                  }}
                />
              </div>

              <div className="flex min-h-8 items-center justify-between gap-2">
                <label className="text-xs font-medium">{t("settings.accentColor.label")}</label>
                <AccentColorSelect
                  value={s.accentColor}
                  onChange={(accentColor) => commitSettings((current) => ({ ...current, accentColor }))}
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

          <TabsContent value="shortcuts" className="m-0 space-y-3">
            <SettingsSection title={t("settings.shortcuts.title")}>
              <div className="space-y-2">
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
                      className="flex min-h-8 items-center justify-between gap-2"
                    >
                      <ShortcutLabel icon={row.icon}>{row.label}</ShortcutLabel>
                      <div className="flex shrink-0 items-center gap-2">
                        <HotkeyRecorder
                          value={s[row.key]}
                          onChange={row.onChange}
                          changeLabel={t("settings.hotkey.change")}
                          clearLabel={t("settings.hotkey.clear", { label: row.label })}
                          inputLabel={t("settings.hotkey.inputLabel", { label: row.label })}
                          onReset={() => resetShortcut(row.key)}
                          recordingLabel={t("settings.hotkey.recording")}
                          resetLabel={t("settings.hotkey.reset", { label: row.label })}
                        />
                        {conflictMessage ? <ShortcutConflictIndicator message={conflictMessage} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SettingsSection>
          </TabsContent>
          <TabsContent value="updates" className="m-0 h-full">
            <UpdaterPanel
              autoCheckSignal={updateCheckSignal}
              language={s.language}
              onAutoCheckConsumed={consumeAutoUpdateCheck}
            />
          </TabsContent>
          <TabsContent value="about" className="m-0 h-full">
            {activeTab === "about" ? <AboutPanel language={s.language} /> : null}
          </TabsContent>
        </div>
      </Tabs>
    </UtilityWindowShell>
  );
}

export function SettingsRoute() {
  return <FlashotRoute initialTab="general" />;
}
