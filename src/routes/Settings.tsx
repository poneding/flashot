import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { HotkeyRecorder } from "@/settings/HotkeyRecorder";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { getSettings, setSettings } from "@/lib/ipc";
import { SELECTION_COLOR } from "@/lib/colors";
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

  const save = async () => {
    await setSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="p-6 space-y-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold">Flashot Settings</h1>

      <div className="space-y-2">
        <ShortcutLabel icon={CropIcon}>Capture Region</ShortcutLabel>
        <HotkeyRecorder
          value={s.captureHotkey}
          onChange={(captureHotkey) => setS({ ...s, captureHotkey })}
        />
      </div>

      <div className="space-y-2">
        <ShortcutLabel icon={MonitorIcon}>Capture Screen</ShortcutLabel>
        <HotkeyRecorder
          value={s.fullscreenHotkey}
          onChange={(fullscreenHotkey) => setS({ ...s, fullscreenHotkey })}
        />
      </div>

      <div className="space-y-2">
        <ShortcutLabel icon={AppWindowIcon}>Capture Window</ShortcutLabel>
        <HotkeyRecorder
          value={s.activeWindowHotkey}
          onChange={(activeWindowHotkey) => setS({ ...s, activeWindowHotkey })}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Theme</label>
        <ThemeSelect value={s.theme} onChange={(theme) => setS({ ...s, theme })} />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="launch-at-login"
          aria-label="Launch at login"
          checked={s.launchAtLogin}
          onCheckedChange={(launchAtLogin) => setS({ ...s, launchAtLogin })}
        />
        <label className="text-sm font-medium" htmlFor="launch-at-login">Launch at login</label>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => setS(defaultSettings())}>Reset</Button>
        <Button onClick={save}>{saved ? "Saved ✓" : "Save"}</Button>
      </div>
    </div>
  );
}
