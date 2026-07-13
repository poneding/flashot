/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutRoute } from "@/routes/About";
import { getSettings } from "@/lib/ipc";
import { open } from "@tauri-apps/plugin-shell";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn(),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("AboutRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("color-scheme");
    document.documentElement.style.removeProperty("--flashot-accent");
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      accentColor: "#F43F5E",
      language: "en",
      launchAtLogin: false,
      autoCheckUpdates: false,
      allowBetaUpdates: false,
      updateCheckIntervalHours: 24,
      lastUpdateCheckAt: null,
      defaultSaveDir: "/Users/dp/Pictures/Flashot",
      lastSaveDir: null,
      cornerRadius: 0,
    });
  });

  it("shows the app version and repository link", async () => {
    render(<AboutRoute />);

    expect(screen.getByRole("heading", { name: "Flashot" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Version: 0.1.0")).toBeTruthy());
    expect(screen.getByText("Author:")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pone Ding" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Author: Pone Ding" })).toBeNull();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" }).querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Source Code" })).toBeNull();
  });

  it("renders About copy in Traditional Chinese", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      accentColor: "#F43F5E",
      language: "zh-TW",
      launchAtLogin: false,
      autoCheckUpdates: false,
      allowBetaUpdates: false,
      updateCheckIntervalHours: 24,
      lastUpdateCheckAt: null,
      defaultSaveDir: "/Users/dp/Pictures/Flashot",
      lastSaveDir: null,
      cornerRadius: 0,
    });

    render(<AboutRoute />);

    await waitFor(() => expect(screen.getByText("版本：0.1.0")).toBeTruthy());
    expect(screen.getByText("作者：")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pone Ding" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "作者：Pone Ding" })).toBeNull();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "原始碼" })).toBeNull();
    expect(screen.getByRole("img", { name: "Flashot 應用程式圖示" })).toBeTruthy();
  });

  it("uses the same centered vertical identity layout as the updater", async () => {
    const { container } = render(<AboutRoute />);

    const icon = screen.getByRole("img", { name: "Flashot app icon" });
    const version = await screen.findByText("Version: 0.1.0");
    const panel = container.querySelector("[data-about-panel]");
    const identity = container.querySelector("[data-about-identity]");
    const links = container.querySelector("[data-about-links]");
    const fields = container.querySelector("[data-flashot-info-fields]");
    const action = container.querySelector("[data-flashot-info-action]");
    const versionLine = container.querySelector("[data-about-version]");
    const authorLine = container.querySelector("[data-about-author]");

    expect(icon.getAttribute("src")).toBe("/app-logo.svg");
    expect(icon.className).toContain("size-12");
    expect(container.querySelector("[data-flashot-info-panel]")).toBe(panel);
    expect(container.querySelector("[data-flashot-info-identity]")).toBe(identity);
    expect(panel?.className).toContain("items-center");
    expect(panel?.className).toContain("justify-center");
    expect(identity?.className).toContain("flex-col");
    expect(links?.className).toContain("flex-col");
    expect(fields?.className).toContain("gap-1");
    expect(fields?.querySelectorAll("[data-flashot-info-field]")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pone Ding" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" }).querySelector("svg")).toBeTruthy();
    expect(action?.contains(screen.getByRole("button", { name: "GitHub" }))).toBe(true);
    expect(versionLine).toBe(version);
    expect(authorLine?.className).toBe(versionLine?.className);
  });

  it("uses the shared utility window shell", async () => {
    const { container } = render(<AboutRoute />);

    expect(container.querySelector('[data-utility-window-shell="flashot"]')).not.toBeNull();
    expect(screen.getByRole("tab", { name: "About" }).getAttribute("data-active")).not.toBeNull();
    await screen.findByText("Version: 0.1.0");
  });

  it("opens the author profile from the about tab", async () => {
    render(<AboutRoute />);

    fireEvent.click(await screen.findByRole("button", { name: "Pone Ding" }));

    expect(open).toHaveBeenCalledWith("https://github.com/poneding");
  });

  it("keeps the compact about window from showing a vertical scrollbar", async () => {
    const { container } = render(<AboutRoute />);

    const main = container.querySelector("main");

    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("overflow-hidden");
    expect(main?.className).not.toContain("min-h-full");
    await screen.findByText("Version: 0.1.0");
  });
  it("applies the saved accent color for primary controls", async () => {
    render(<AboutRoute />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("applies the saved dark theme for the utility window", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "dark",
      accentColor: "#F43F5E",
      language: "en",
      launchAtLogin: false,
      autoCheckUpdates: false,
      allowBetaUpdates: false,
      updateCheckIntervalHours: 24,
      lastUpdateCheckAt: null,
      defaultSaveDir: "/Users/dp/Pictures/Flashot",
      lastSaveDir: null,
      cornerRadius: 0,
    });

    render(<AboutRoute />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

});
