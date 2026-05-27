/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsRoute } from "@/routes/Settings";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { getSettings, setSettings } from "@/lib/ipc";
import { SELECTION_COLOR } from "@/lib/colors";
import type { Settings } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const settings: Settings = {
  captureHotkey: "Cmd+Shift+A",
  fullscreenHotkey: "Cmd+Shift+F",
  activeWindowHotkey: "Cmd+Shift+W",
  theme: "system",
  accentColor: SELECTION_COLOR,
  language: "system",
  launchAtLogin: false,
  lastSaveDir: null,
  cornerRadius: 0,
};

describe("ThemeSelect", () => {
  it("shows the display title for the selected theme instead of the stored value", () => {
    render(<ThemeSelect value="dark" onChange={vi.fn()} />);

    const trigger = screen.getByRole("combobox");

    expect(trigger.textContent).toContain("Dark");
    expect(trigger.textContent).not.toContain("dark");
  });
});

describe("SettingsRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    document.documentElement.style.removeProperty("--flashot-accent");
    document.documentElement.style.removeProperty("--flashot-accent-rgb");
    document.documentElement.style.removeProperty("--primary");
    document.documentElement.style.removeProperty("--ring");
    document.documentElement.style.removeProperty("--accent");
    vi.mocked(getSettings).mockResolvedValue(settings);
    vi.mocked(setSettings).mockResolvedValue();
  });

  it("edits launch at login with an accessible checkbox", async () => {
    render(<SettingsRoute />);

    const checkbox = await screen.findByRole("checkbox", { name: "Launch at login" });

    expect(checkbox.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({
        ...settings,
        launchAtLogin: true,
      });
    });
  });

  it("shows editable shortcuts for region, screen, and window capture", async () => {
    render(<SettingsRoute />);

    expect(await screen.findByText("Capture Region")).toBeTruthy();
    expect(screen.getByText("Capture Screen")).toBeTruthy();
    expect(screen.getByText("Capture Window")).toBeTruthy();

    expect(screen.getByText("Cmd+Shift+A")).toBeTruthy();
    expect(screen.getByText("Cmd+Shift+F")).toBeTruthy();
    expect(screen.getByText("Cmd+Shift+W")).toBeTruthy();
    expect(screen.queryByText(/CommandOrControl/)).toBeNull();
  });

  it("groups settings into shortcut, capture, appearance, and general sections", async () => {
    const { container } = render(<SettingsRoute />);

    expect(await screen.findByRole("heading", { name: "Shortcuts" })).toBeTruthy();
    expect(container.querySelector('[data-utility-window-shell="settings"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Capture" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
  });

  it("renders settings labels in Simplified Chinese when selected", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, language: "zh-CN" });

    render(<SettingsRoute />);

    expect(await screen.findByRole("heading", { name: "快捷键" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "截图" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "通用" })).toBeTruthy();
    expect(screen.getByText("截图区域")).toBeTruthy();
    expect(screen.getByLabelText("语言")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("saves accent color and language selections", async () => {
    render(<SettingsRoute />);

    await screen.findByRole("heading", { name: "Appearance" });
    fireEvent.click(screen.getByRole("button", { name: "Accent color: Rose" }));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-CN" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        accentColor: "#F43F5E",
        language: "zh-CN",
      }));
    });
  });

  it("updates document accent variables from the selected accent color", async () => {
    render(<SettingsRoute />);

    await screen.findByRole("heading", { name: "Appearance" });

    expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe(SELECTION_COLOR);

    fireEvent.click(screen.getByRole("button", { name: "Accent color: Rose" }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
    expect(document.documentElement.style.getPropertyValue("--primary")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--ring")).not.toBe("");
  });

  it("uses compact shortcut label icons", async () => {
    render(<SettingsRoute />);

    const label = (await screen.findByText("Capture Region")).closest("label");
    const icon = label?.querySelector("svg");

    expect(icon?.getAttribute("width")).toBe("14");
    expect(icon?.getAttribute("height")).toBe("14");
    expect(icon?.getAttribute("stroke-width")).toBe("1.55");
  });

  it("places the launch at login checkbox directly to the left of its label", async () => {
    render(<SettingsRoute />);

    const checkbox = await screen.findByRole("checkbox", { name: "Launch at login" });
    const label = screen.getByText("Launch at login");

    expect(
      checkbox.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fills appearance defaults when loading legacy settings", async () => {
    const legacySettings = {
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      launchAtLogin: false,
      lastSaveDir: null,
      cornerRadius: 0,
    } as Settings;
    vi.mocked(getSettings).mockResolvedValue(legacySettings);

    render(<SettingsRoute />);

    await screen.findByText("Capture Region");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        accentColor: SELECTION_COLOR,
        language: "system",
      }));
    });
  });
});
