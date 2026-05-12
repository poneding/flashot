import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const traySource = readFileSync(
  path.resolve(__dirname, "../../src-tauri/src/tray.rs"),
  "utf8",
);

describe("tray menu", () => {
  it("uses the configured capture hotkey for the capture accelerator", () => {
    expect(traySource).toMatch(/install\(app: &AppHandle, capture_hotkey: &str\)/);
    expect(traySource).toContain("capture_menu_accelerator(capture_hotkey)");
    expect(traySource).toContain("pub fn update_menu(app: &AppHandle, capture_hotkey: &str)");
  });

  it("marks settings with a platform-aware accelerator", () => {
    expect(traySource).toContain("CommandOrControl+,");
  });

  it("marks quit with a platform-aware accelerator that exits the app", () => {
    expect(traySource).toContain("CommandOrControl+Q");
    expect(traySource).toContain('"quit" => app.exit(0)');
  });
});
