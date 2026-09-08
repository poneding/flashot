/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsRoute } from "@/routes/Settings";
import { chooseDefaultSaveDir, getSettings, setSettings } from "@/lib/ipc";
import { SELECTION_COLOR } from "@/lib/colors";
import type { Settings } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  chooseDefaultSaveDir: vi.fn(),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const currentWindowMock = vi.hoisted(() => ({
  setTitle: vi.fn().mockResolvedValue(undefined),
  theme: vi.fn().mockResolvedValue(null as "light" | "dark" | null),
  onThemeChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => currentWindowMock),
}));

const settings: Settings = {
  captureHotkey: "Cmd+Shift+A",
  boardHotkey: "Option+B",
  fullscreenHotkey: "Cmd+Shift+F",
  activeWindowHotkey: "Cmd+Shift+W",
  theme: "system",
  accentColor: SELECTION_COLOR,
  language: "en",
  launchAtLogin: false,
  autoCheckUpdates: false,
  allowBetaUpdates: false,
  updateCheckIntervalHours: 24,
  lastUpdateCheckAt: null,
  defaultSaveDir: "/Users/dp/Pictures/Flashot",
  lastSaveDir: null,
  cornerRadius: 0,
};


beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.defineProperty(window.navigator, "platform", { configurable: true, value: "MacIntel" });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(query => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  vi.mocked(getSettings).mockResolvedValue({ ...settings });
  vi.mocked(setSettings).mockImplementation(async (patch) => {
    const next = { ...await getSettings(), ...patch };
    vi.mocked(getSettings).mockResolvedValue(next);
    return next;
  });
  vi.mocked(chooseDefaultSaveDir).mockResolvedValue(null);
});
afterEach(() => cleanup());
it("saving a preference preserves fields changed outside the settings window", async () => {
  render(<SettingsRoute />);
  await screen.findByDisplayValue(settings.defaultSaveDir);
  vi.mocked(getSettings).mockResolvedValue({ ...settings, cornerRadius: 24, lastUpdateCheckAt: 123456 });
  fireEvent.click(screen.getByRole("checkbox", { name: "Launch at login" }));
  await waitFor(() => expect(setSettings).toHaveBeenCalled());
  expect((await getSettings()).cornerRadius).toBe(24);
});
it("a failed settings save does not leave the toggle showing an unpersisted value", async () => {
  vi.mocked(setSettings).mockRejectedValue(new Error("could not enable autostart"));
  render(<SettingsRoute />);
  await screen.findByDisplayValue(settings.defaultSaveDir);
  const checkbox = screen.getByRole("checkbox", { name: "Launch at login" });
  fireEvent.click(checkbox);
  await waitFor(() => expect(setSettings).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("alert").textContent).toContain("could not enable autostart");
});
