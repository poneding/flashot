import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const REPO_URL = "https://github.com/poneding/flashot";

export function AboutRoute() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Flashot</h1>
        <p className="text-sm text-muted-foreground">
          {version ? `Version ${version}` : "Version unavailable"}
        </p>
      </div>
      <Button variant="outline" onClick={() => open(REPO_URL)}>
        GitHub Repository
      </Button>
    </main>
  );
}
