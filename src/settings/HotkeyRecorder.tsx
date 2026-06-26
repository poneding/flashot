import { PenIcon, Undo2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const MOD_NAMES = ["Meta", "Control", "Alt", "Shift"];

export function formatHotkeyForPlatform(value: string, platform = window.navigator.platform): string {
  const isApple = /Mac|iPhone|iPad|iPod/.test(platform);
  const commandOrControl = isApple ? "Cmd" : "Ctrl";
  const meta = isApple ? "Cmd" : /Win/.test(platform) ? "Win" : "Super";
  return value
    .replace(/CommandOrControl/gi, commandOrControl)
    .replace(/\b(Command|Cmd|Meta|Super|Win|Windows)\b/gi, meta)
    .replace(/\bAlt\b/gi, isApple ? "Option" : "Alt")
    .replace(/\bOption\b/gi, isApple ? "Option" : "Alt");
}

export function HotkeyRecorder({
  value,
  onChange,
  changeLabel = "Change",
  recordingLabel = "Press keys...",
  inputLabel = "Shortcut",
  clearLabel = "Clear shortcut",
  resetLabel,
  onReset,
}: {
  value: string;
  onChange: (s: string) => void;
  changeLabel?: string;
  recordingLabel?: string;
  inputLabel?: string;
  clearLabel?: string;
  resetLabel?: string;
  onReset?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    if (!editing) setDraftValue(value);
  }, [editing, value]);

  const startRecord = () => {
    if (recording) return;
    setEditing(false);
    setRecording(true);
    const handler = (e: KeyboardEvent) => {
      if (MOD_NAMES.includes(e.key)) return; // wait for non-modifier
      e.preventDefault();
      const parts: string[] = [];
      if (e.metaKey) {
        parts.push(formatHotkeyForPlatform("Meta", window.navigator.platform));
      }
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      const nextValue = parts.join("+");
      setDraftValue(nextValue);
      onChange(nextValue);
      setRecording(false);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("keydown", handler);
  };

  const displayValue = editing ? draftValue : formatHotkeyForPlatform(value);

  const updateManualValue = (nextValue: string) => {
    setDraftValue(nextValue);
    onChange(nextValue);
  };

  const clearHotkey = () => {
    setDraftValue("");
    onChange("");
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div data-hotkey-field className="relative h-7 w-36 shrink-0">
        <input
          aria-label={inputLabel}
          className="h-7 w-36 rounded-md border border-input bg-background pl-2 pr-14 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          inputMode="text"
          onBlur={() => setEditing(false)}
          onChange={(event) => updateManualValue(event.currentTarget.value)}
          onFocus={() => {
            setEditing(true);
            setDraftValue(value);
          }}
          placeholder={recording ? recordingLabel : ""}
          readOnly={recording}
          spellCheck={false}
          type="text"
          value={displayValue}
        />
        {onReset && resetLabel ? (
          <Button
            aria-label={resetLabel}
            className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={onReset}
            title={resetLabel}
            type="button"
            variant="ghost"
            size="icon-xs"
          >
            <Undo2Icon aria-hidden="true" size={14} strokeWidth={1.8} />
          </Button>
        ) : null}
        <Button
          aria-label={clearLabel}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={clearHotkey}
          title={clearLabel}
          type="button"
          variant="ghost"
          size="icon-xs"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <Button
        aria-label={recording ? recordingLabel : changeLabel}
        className="text-muted-foreground hover:text-foreground"
        disabled={recording}
        onClick={startRecord}
        title={recording ? recordingLabel : changeLabel}
        type="button"
        variant="ghost"
        size="icon-xs"
      >
        <PenIcon aria-hidden="true" size={14} strokeWidth={1.8} />
      </Button>
    </div>
  );
}
