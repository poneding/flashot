import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Tauri capabilities", () => {
  it("grants IPC permissions to overlay and settings windows", () => {
    const capabilityPath = resolve(__dirname, "../../src-tauri/capabilities/default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as { windows: string[] };

    expect(capability.windows).toContain("overlay-*");
    expect(capability.windows).toContain("settings");
  });
});

describe("Tauri asset protocol", () => {
  it("allows overlay windows to load frozen screenshot frames from app cache", () => {
    const configPath = resolve(__dirname, "../../src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      app?: {
        security?: {
          assetProtocol?: {
            enable?: boolean;
            scope?: string[];
          };
        };
      };
    };

    expect(config.app?.security?.assetProtocol?.enable).toBe(true);
    expect(config.app?.security?.assetProtocol?.scope).toContain("$APPCACHE/frame_*.png");
  });

  it("keeps the Rust asset protocol feature enabled for direct cargo builds", () => {
    const manifestPath = resolve(__dirname, "../../src-tauri/Cargo.toml");
    const manifest = readFileSync(manifestPath, "utf8");

    expect(manifest).toContain('"protocol-asset"');
  });
});
