import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Tauri capabilities", () => {
  it("uses the branded app name for user-visible bundle metadata", () => {
    const configPath = resolve(__dirname, "../../src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { productName?: string };

    expect(config.productName).toBe("Flashot");
  });

  it("does not bundle extra macOS frameworks", () => {
    const configPath = resolve(__dirname, "../../src-tauri/tauri.conf.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      bundle?: {
        macOS?: {
          frameworks?: string[];
        };
      };
    };

    expect(config.bundle?.macOS?.frameworks ?? []).toEqual([]);
  });

  it("grants IPC permissions to overlay and utility windows", () => {
    const capabilityPath = resolve(__dirname, "../../src-tauri/capabilities/default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      windows: string[];
      permissions: string[];
    };

    expect(capability.windows).toContain("overlay-*");
    expect(capability.windows).toContain("flashot");
    expect(capability.windows).toContain("settings");
    expect(capability.windows).toContain("about");
    expect(capability.permissions).toContain("core:window:allow-set-cursor-icon");
    expect(capability.permissions).toContain("core:window:allow-set-title");
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
    expect(config.app?.security?.assetProtocol?.scope).toContain("$APPCACHE/pins/pin-*.png");
  });

  it("keeps the Rust asset protocol feature enabled for direct cargo builds", () => {
    const manifestPath = resolve(__dirname, "../../src-tauri/Cargo.toml");
    const manifest = readFileSync(manifestPath, "utf8");

    expect(manifest).toContain('"protocol-asset"');
  });

  it("registers the autostart plugin for real launch-at-login support", () => {
    const manifestPath = resolve(__dirname, "../../src-tauri/Cargo.toml");
    const manifest = readFileSync(manifestPath, "utf8");
    const libPath = resolve(__dirname, "../../src-tauri/src/lib.rs");
    const lib = readFileSync(libPath, "utf8");

    expect(manifest).toContain("tauri-plugin-autostart");
    expect(lib).toContain("tauri_plugin_autostart::init");
  });

  it("keeps quick shot flash feedback wired through overlay event helpers", () => {
    const ipcSource = readFileSync(resolve(__dirname, "../lib/ipc.ts"), "utf8");
    const overlaySource = readFileSync(resolve(__dirname, "../routes/Overlay.tsx"), "utf8");

    expect(ipcSource).toContain("quick-shot:flash");
    expect(overlaySource).toContain("onQuickShotFlash");
    expect(overlaySource).toContain("QuickShotFlash");
  });

  it("draws quick shot feedback with an inward glow and no border", () => {
    const styles = readFileSync(resolve(__dirname, "../styles/globals.css"), "utf8");
    const flashRule = styles.match(/body\.overlay \.quick-shot-flash \{([\s\S]*?)\n  \}/)?.[1] ?? "";

    expect(flashRule).not.toContain("border:");
    expect(flashRule).toMatch(/box-shadow:[\s\S]*inset/);
    expect(flashRule).not.toContain("9999px");
  });
});
