import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { UpdaterRoute } from "@/routes/Updater";
import { getSettings } from "@/lib/ipc";

// Mock dependencies
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.2.1"),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ close: vi.fn(), setSize: vi.fn() })),
  // Regular function (not arrow) so it stays constructable: the component
  // does `new LogicalSize(...)`. Vitest 4+ rejects `new` on arrow-function mocks.
  LogicalSize: vi.fn(function (w: number, h: number) {
    return { width: w, height: h };
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn(),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

const mockCheckForUpdate = vi.fn();
const mockDownloadAndInstall = vi.fn();

vi.mock("@/lib/updater", () => ({
  checkForUpdate: (...args: unknown[]) => mockCheckForUpdate(...args),
  downloadAndInstall: (...args: unknown[]) => mockDownloadAndInstall(...args),
}));

describe("UpdaterRoute", () => {
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

  it("applies the saved accent color for primary controls", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));

    render(<UpdaterRoute />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("applies the saved dark theme for the utility window", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));
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

    render(<UpdaterRoute />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("uses the shared utility window shell", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));

    const { container } = render(<UpdaterRoute />);

    expect(container.querySelector('[data-utility-window-shell="updater"]')).not.toBeNull();
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("shows checking state on mount", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<UpdaterRoute />);
    expect(screen.getByText("Checking for updates…")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("shows checking state in Traditional Chinese", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {}));
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

    render(<UpdaterRoute />);

    await waitFor(() => {
      expect(screen.getByText("正在檢查更新…")).toBeInTheDocument();
    });
  });

  it("shows up-to-date when no update available", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
    expect(screen.getByText("Version 0.2.1")).toBeInTheDocument();
  });

  it("checks the beta channel when beta updates are allowed", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      accentColor: "#F43F5E",
      language: "en",
      launchAtLogin: false,
      autoCheckUpdates: false,
      allowBetaUpdates: true,
      updateCheckIntervalHours: 24,
      lastUpdateCheckAt: null,
      defaultSaveDir: "/Users/dp/Pictures/Flashot",
      lastSaveDir: null,
      cornerRadius: 0,
    });
    mockCheckForUpdate.mockResolvedValue(null);

    render(<UpdaterRoute />);

    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledWith({ allowBeta: true });
    });
    expect(screen.getByText("Beta updates: allowed")).toBeInTheDocument();
  });

  it("shows available state with version info", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: "Bug fixes and improvements",
      date: "2026-05-19",
    });
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    expect(screen.getByText("Bug fixes and improvements")).toBeInTheDocument();
  });

  it("renders release notes as Markdown instead of raw Markdown text", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: "## Changes\n\n- **Fix** the updater notes",
      date: "2026-05-19",
    });

    render(<UpdaterRoute />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    });
    expect(screen.getByText("Fix")).toBeInTheDocument();
    expect(screen.queryByText(/## Changes/)).not.toBeInTheDocument();
  });

  it("shows available state without release notes when body is empty", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: undefined,
      date: undefined,
    });
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.queryByText("Bug fixes")).not.toBeInTheDocument();
  });

  it("shows error state when check fails", async () => {
    mockCheckForUpdate.mockRejectedValue(new Error("Network error"));
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Update check failed")).toBeInTheDocument();
    });
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("retry button re-checks for updates", async () => {
    mockCheckForUpdate.mockRejectedValueOnce(new Error("Network error"));
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Update check failed")).toBeInTheDocument();
    });

    mockCheckForUpdate.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByText("Retry"));
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
  });

  it("download button transitions to downloading state", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: null,
      date: null,
    });
    mockDownloadAndInstall.mockReturnValue(new Promise(() => {})); // never resolves

    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Download & Install")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Download & Install"));
    expect(screen.getByText("Downloading…")).toBeInTheDocument();
  });

  it("downloads from the beta channel selected during the check", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      accentColor: "#F43F5E",
      language: "en",
      launchAtLogin: false,
      autoCheckUpdates: false,
      allowBetaUpdates: true,
      updateCheckIntervalHours: 24,
      lastUpdateCheckAt: null,
      defaultSaveDir: "/Users/dp/Pictures/Flashot",
      lastSaveDir: null,
      cornerRadius: 0,
    });
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0-beta.1",
      body: null,
      date: null,
    });
    mockDownloadAndInstall.mockResolvedValue(undefined);

    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Download & Install")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Download & Install"));

    expect(mockDownloadAndInstall).toHaveBeenCalledWith(expect.any(Function), { allowBeta: true });
  });

  it("close button calls window close", async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const mockClose = vi.fn();
    vi.mocked(getCurrentWindow).mockReturnValue({ close: mockClose } as any);

    mockCheckForUpdate.mockResolvedValue(null);
    render(<UpdaterRoute />);
    await waitFor(() => {
      expect(screen.getByText("Close")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Close"));
    expect(mockClose).toHaveBeenCalled();
  });
});
