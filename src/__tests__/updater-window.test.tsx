import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FlashotRoute } from "@/routes/Settings";
import { UpdaterRoute } from "@/routes/Updater";
import { getSettings } from "@/lib/ipc";

// Mock dependencies
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.2.1"),
}));

const currentWindowMock = vi.hoisted(() => ({
  close: vi.fn(),
  setSize: vi.fn(),
  theme: vi.fn().mockResolvedValue(null as "light" | "dark" | null),
  onThemeChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => currentWindowMock),
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
    window.location.hash = "";
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

    expect(container.querySelector('[data-utility-window-shell="flashot"]')).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Updates" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Updates" }).getAttribute("data-active")).not.toBeNull();
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("waits for the user to request an update check", async () => {
    mockCheckForUpdate.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<UpdaterRoute />);
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    expect(screen.queryByText("Checking for updates…")).not.toBeInTheDocument();
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(container.querySelector("[data-updater-identity]")?.className).toContain("flex-col");
    expect(container.querySelector("[data-flashot-info-panel]")).toBe(container.querySelector("[data-updater-panel]"));
    expect(container.querySelector("[data-flashot-info-identity]")).toBe(container.querySelector("[data-updater-identity]"));
    expect(container.querySelector("[data-flashot-info-fields]")?.className).toContain("gap-1");
    expect(container.querySelectorAll("[data-flashot-info-field]")).toHaveLength(2);
    expect(container.querySelector("[data-updater-channel]")?.textContent).toBe("Beta updates: stable only");
    expect(container.querySelector("[data-flashot-info-action]")?.contains(screen.getByRole("button", { name: "Check for updates" }))).toBe(true);
    await waitFor(() => {
      expect(screen.getByText("Version: 0.2.1")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

  it("shows checking state in Traditional Chinese after the check button is clicked", async () => {
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

    await userEvent.click(await screen.findByRole("button", { name: "檢查更新" }));

    await waitFor(() => {
      expect(screen.getByText("正在檢查更新…")).toBeInTheDocument();
    });
  });

  it("shows up-to-date when no update available", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    const { container } = render(<UpdaterRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
    const result = container.querySelector("[data-updater-result]");
    const action = container.querySelector("[data-flashot-info-action]");
    expect(result).toBeTruthy();
    expect(action).toBeTruthy();
    const resultElement = result as Element;
    const actionElement = action as Element;
    expect(resultElement.compareDocumentPosition(actionElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const checkButton = screen.getByRole("button", { name: "Check for updates" });
    expect(actionElement.contains(checkButton)).toBe(true);
    expect(checkButton.className).toContain("bg-primary");
    expect(screen.getByText("Version: 0.2.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("does not check updates when the updates tab is selected normally", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    window.location.hash = "#/flashot/general";

    render(<FlashotRoute />);
    await userEvent.click(await screen.findByRole("tab", { name: "Updates" }));

    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
  });

  it("does not reuse stale check params when the updates tab is selected manually", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    window.location.hash = "#/flashot/general?check=1&request=77";

    render(<FlashotRoute />);

    await screen.findByRole("tab", { name: "General" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockCheckForUpdate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("tab", { name: "Updates" }));
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockCheckForUpdate).not.toHaveBeenCalled();
  });

  it("consumes menu-triggered update checks after starting them", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    window.location.hash = "#/flashot/updates?check=1&request=42";

    render(<FlashotRoute />);

    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
    expect(window.location.hash).toBe("#/flashot/updates");
  });

  it("does not recheck when returning to updates after a menu-triggered check", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    window.location.hash = "#/flashot/updates?check=1&request=42";

    render(<FlashotRoute />);

    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });

    await userEvent.click(screen.getByRole("tab", { name: "General" }));
    await userEvent.click(screen.getByRole("tab", { name: "Updates" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    });
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
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
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));

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
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    expect(screen.getByText("Bug fixes and improvements")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
  });

  it("renders release notes as Markdown instead of raw Markdown text", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: "## Changes\n\n- **Fix** the updater notes",
      date: "2026-05-19",
    });

    render(<UpdaterRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Changes" })).toBeInTheDocument();
    });
    expect(screen.getByText("Fix")).toBeInTheDocument();
    expect(screen.queryByText(/## Changes/)).not.toBeInTheDocument();
    expect(currentWindowMock.setSize).not.toHaveBeenCalled();
  });

  it("shows available state without release notes when body is empty", async () => {
    mockCheckForUpdate.mockResolvedValue({
      version: "0.3.0",
      body: undefined,
      date: undefined,
    });
    render(<UpdaterRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(screen.getByText("A new version is available")).toBeInTheDocument();
    });
    expect(screen.queryByText("Bug fixes")).not.toBeInTheDocument();
  });

  it("shows error state when check fails", async () => {
    mockCheckForUpdate.mockRejectedValue(new Error("Network error"));
    render(<UpdaterRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(screen.getByText("Update check failed")).toBeInTheDocument();
    });
    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("retry button re-checks for updates", async () => {
    mockCheckForUpdate.mockRejectedValueOnce(new Error("Network error"));
    render(<UpdaterRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(screen.getByText("Download & Install")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Download & Install"));

    expect(mockDownloadAndInstall).toHaveBeenCalledWith(expect.any(Function), { allowBeta: true });
  });

  it("centers update content and starts checking from the menu check route", async () => {
    mockCheckForUpdate.mockResolvedValue(null);
    window.location.hash = "#/flashot/updates?check=1";

    const { container } = render(<FlashotRoute />);

    const panel = container.querySelector("[data-updater-panel]");
    expect(panel?.className).toContain("items-center");
    expect(panel?.className).toContain("text-center");
    await waitFor(() => {
      expect(screen.getByText("You're up to date")).toBeInTheDocument();
    });
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
  });
});
