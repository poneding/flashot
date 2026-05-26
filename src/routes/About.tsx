import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { UtilityWindowShell } from "@/components/UtilityWindowShell";
import { useStoredAccentColor } from "@/settings/useStoredAccentColor";

const REPO_URL = "https://github.com/poneding/flashot";

export function AboutRoute() {
  const [version, setVersion] = useState<string | null>(null);
  useStoredAccentColor();

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  return (
    <UtilityWindowShell
      windowName="about"
      className="overflow-hidden"
      contentClassName="flex flex-col items-center justify-center gap-4 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold">Flashot</h1>
        <img
          src="/app-logo.svg"
          alt="Flashot app icon"
          className="size-16"
          draggable={false}
        />
        <p className="font-mono text-sm text-muted-foreground">
          {version ? `Version ${version}` : "Version unavailable"}
        </p>
      </div>
      <Button onClick={() => open(REPO_URL)}>
        GitHub Repository
      </Button>
    </UtilityWindowShell>
  );
}
