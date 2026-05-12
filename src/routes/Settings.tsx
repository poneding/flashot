import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { HotkeyRecorder } from "@/settings/HotkeyRecorder";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { getSettings, setSettings } from "@/lib/ipc";
import type { Settings } from "@/lib/types";

const DEFAULTS: Settings = {
  hotkey: navigator.platform.includes("Mac") ? "Cmd+Shift+A" : "Ctrl+Shift+A",
  theme: "system",
  launchAtLogin: false,
  lastSaveDir: null,
};

export function SettingsRoute() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [saved, setSaved] = useState(false);

  useEffect(() => { getSettings().then(setS).catch(() => {}); }, []);

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
        <label className="text-sm font-medium">Hotkey</label>
        <HotkeyRecorder value={s.hotkey} onChange={(hotkey) => setS({ ...s, hotkey })} />
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
        <Button variant="outline" onClick={() => setS(DEFAULTS)}>Reset</Button>
        <Button onClick={save}>{saved ? "Saved ✓" : "Save"}</Button>
      </div>
    </div>
  );
}
