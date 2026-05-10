import { useState } from "react";
import { Button } from "@/components/ui/button";

const MOD_NAMES = ["Meta", "Control", "Alt", "Shift"];

export function HotkeyRecorder({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  const startRecord = () => {
    setRecording(true);
    const handler = (e: KeyboardEvent) => {
      if (MOD_NAMES.includes(e.key)) return; // wait for non-modifier
      e.preventDefault();
      const parts: string[] = [];
      if (e.metaKey) parts.push("Cmd");
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(key);
      onChange(parts.join("+"));
      setRecording(false);
      window.removeEventListener("keydown", handler);
    };
    window.addEventListener("keydown", handler);
  };

  return (
    <div className="flex items-center gap-3">
      <code className="rounded bg-muted px-2 py-1 text-sm">{value}</code>
      <Button onClick={startRecord} disabled={recording} variant="outline" size="sm">
        {recording ? "Press keys…" : "Change"}
      </Button>
    </div>
  );
}
