/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsRoute } from "@/routes/Settings";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { chooseDefaultSaveDir, getSettings, setSettings } from "@/lib/ipc";
import { SELECTION_COLOR } from "@/lib/colors";
import type { Settings } from "@/lib/types";

vi.mock("@/lib/ipc", () => ({
  chooseDefaultSaveDir: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const currentWindowMock = vi.hoisted(() => ({
  setTitle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => currentWindowMock),
}));

const settings: Settings = {
  captureHotkey: "Cmd+Shift+A",
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
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("color-scheme");
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
    vi.mocked(chooseDefaultSaveDir).mockResolvedValue(null);
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

  it("hides beta updates until automatic update checks are enabled", async () => {
    render(<SettingsRoute />);

    const autoCheck = await screen.findByRole("checkbox", { name: "Automatically check for updates" });

    expect(autoCheck.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("checkbox", { name: "Allow beta updates" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Update check interval in hours" })).toBeNull();

    fireEvent.click(autoCheck);

    const beta = await screen.findByRole("checkbox", { name: "Allow beta updates" });
    const interval = screen.getByRole("spinbutton", { name: "Update check interval in hours" }) as HTMLInputElement;

    expect(beta.getAttribute("aria-checked")).toBe("false");
    expect(
      autoCheck.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(interval.value).toBe("24");

    fireEvent.change(interval, { target: { value: "6" } });

    fireEvent.click(beta);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({
        ...settings,
        autoCheckUpdates: true,
        allowBetaUpdates: true,
        updateCheckIntervalHours: 6,
      });
    });
  });

  it("clears beta update opt-in when automatic update checks are disabled", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...settings,
      autoCheckUpdates: true,
      allowBetaUpdates: true,
      updateCheckIntervalHours: 6,
    });
    render(<SettingsRoute />);

    const autoCheck = await screen.findByRole("checkbox", { name: "Automatically check for updates" });
    expect(screen.getByRole("checkbox", { name: "Allow beta updates" })).toBeTruthy();

    fireEvent.click(autoCheck);

    expect(screen.queryByRole("checkbox", { name: "Allow beta updates" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        autoCheckUpdates: false,
        allowBetaUpdates: false,
        updateCheckIntervalHours: 6,
      }));
    });
  });

  it("shows and changes the default screenshot save location", async () => {
    vi.mocked(chooseDefaultSaveDir).mockResolvedValue("/Users/dp/Desktop/Shots");

    render(<SettingsRoute />);

    const input = await screen.findByDisplayValue("/Users/dp/Pictures/Flashot") as HTMLInputElement;
    const field = input.closest("[data-default-save-field]");
    const row = input.closest("[data-default-save-row]");
    const checkbox = screen.getByRole("checkbox", { name: "Launch at login" });
    const changeButton = screen.getByRole("button", { name: "Change default save location" });

    expect(input.disabled).toBe(true);
    expect(input.className).toContain("h-8");
    expect(field).toBeTruthy();
    expect(field?.className).toContain("relative");
    expect(field?.contains(changeButton)).toBe(true);
    expect(changeButton.className).toContain("absolute");
    expect(changeButton.className).toContain("right-1");
    expect(changeButton.textContent).toBe("");
    expect(
      (row as Element).compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(changeButton);
    await screen.findByDisplayValue("/Users/dp/Desktop/Shots");
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(chooseDefaultSaveDir).toHaveBeenCalledWith("/Users/dp/Pictures/Flashot");
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        defaultSaveDir: "/Users/dp/Desktop/Shots",
      }));
    });
  });

  it("shows editable shortcuts for area, screen, and active window capture", async () => {
    render(<SettingsRoute />);

    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    expect(await screen.findByText("Capture Area")).toBeTruthy();
    expect(screen.getByText("Capture Screen")).toBeTruthy();
    expect(screen.getByText("Capture Active Window")).toBeTruthy();

    expect(screen.getByDisplayValue("Cmd+Shift+A")).toBeTruthy();
    expect(screen.getByDisplayValue("Cmd+Shift+F")).toBeTruthy();
    expect(screen.getByDisplayValue("Cmd+Shift+W")).toBeTruthy();
    expect(screen.queryByText(/CommandOrControl/)).toBeNull();
  });

  it("renders each shortcut setting on a single row", async () => {
    render(<SettingsRoute />);

    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    const row = (await screen.findByText("Capture Area")).closest("[data-shortcut-row]");

    expect(row).toBeTruthy();
    expect(row?.className).toContain("flex");
    expect(row?.querySelector("label")?.textContent).toContain("Capture Area");
    expect(row?.querySelector("input")?.getAttribute("value")).toBe("Cmd+Shift+A");
    expect(Array.from(row?.querySelectorAll("button") ?? []).some((button) => button.textContent === "Change")).toBe(true);
  });

  it("keeps shortcut values in fixed editable fields with an embedded clear button", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...settings,
      captureHotkey: "",
    });
    render(<SettingsRoute />);

    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    const input = await screen.findByRole("textbox", { name: "Capture Area shortcut" }) as HTMLInputElement;

    expect(input.value).toBe("");
    expect(input.className).toContain("w-36");
    expect(input.className).toContain("h-8");
    expect(input.className).toContain("pr-8");

    const field = input.closest("[data-hotkey-field]");
    const clearButton = screen.getByRole("button", { name: "Clear Capture Area shortcut" });

    expect(field).toBeTruthy();
    expect(field?.className).toContain("relative");
    expect(field?.contains(clearButton)).toBe(true);
    expect(clearButton.className).toContain("absolute");
    expect(clearButton.className).toContain("right-1");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ctrl+Alt+S" } });
    expect(input.value).toBe("Ctrl+Alt+S");

    fireEvent.click(clearButton);
    expect(input.value).toBe("");

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ctrl+Alt+S" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        captureHotkey: "Ctrl+Alt+S",
      }));
    });
  });

  it("resets quick shot shortcuts to macOS Option defaults", async () => {
    render(<SettingsRoute />);

    await screen.findByRole("tab", { name: "Shortcuts" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("tab", { name: "Shortcuts" }));

    expect(await screen.findByDisplayValue("Option+F")).toBeTruthy();
    expect(screen.getByDisplayValue("Option+W")).toBeTruthy();
  });

  it("shows conflict info when shortcut settings duplicate each other", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...settings,
      fullscreenHotkey: "Cmd+Shift+A",
    });
    render(<SettingsRoute />);

    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    const captureRow = (await screen.findByText("Capture Area")).closest("[data-shortcut-row]");
    const screenRow = screen.getByText("Capture Screen").closest("[data-shortcut-row]");

    const captureConflict = captureRow?.querySelector("[data-shortcut-conflict]");
    expect(captureConflict).toBeTruthy();
    expect(screenRow?.querySelector("[data-shortcut-conflict]")).toBeTruthy();
    expect(screen.getByText("Capture Active Window").closest("[data-shortcut-row]")?.querySelector("[data-shortcut-conflict]")).toBeNull();

    fireEvent.mouseEnter(captureConflict as Element);

    expect((await screen.findByRole("tooltip")).textContent).toBe("Capture Area conflicts with Capture Screen");
  });

  it("groups settings into general, appearance, and shortcut tabs", async () => {
    const { container } = render(<SettingsRoute />);

    expect(await screen.findByRole("tab", { name: "General" })).toBeTruthy();
    expect(container.querySelector('[data-utility-window-shell="settings"]')).not.toBeNull();
    expect(container.querySelector("[data-utility-window-content]")?.className).toContain("max-w-lg");
    expect(screen.getByRole("tab", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Shortcuts" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Shortcuts" }));
    expect(await screen.findByText("Capture Area")).toBeTruthy();
  });

  it("renders settings labels in Simplified Chinese when selected", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, language: "zh-CN" });

    render(<SettingsRoute />);

    expect(await screen.findByRole("tab", { name: "快捷键" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "外观" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "通用" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "快捷键" }));
    expect(screen.getByText("截取区域")).toBeTruthy();
    expect(screen.getByText("截取当前活动窗口")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "外观" }));
    expect(screen.getByLabelText("语言")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  it("saves accent color and language selections", async () => {
    const user = userEvent.setup();
    render(<SettingsRoute />);

    await screen.findByRole("tab", { name: "Appearance" });
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Accent color: Rose" }));
    await user.click(screen.getByLabelText("Language"));
    expect(screen.queryByRole("option", { name: "System" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "繁體中文" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        accentColor: "#F43F5E",
        language: "zh-TW",
      }));
    });
  });

  it("renders settings labels in Traditional Chinese when selected", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, language: "zh-TW" });

    render(<SettingsRoute />);

    expect(await screen.findByRole("tab", { name: "快速鍵" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "外觀" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "一般" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "快速鍵" }));
    expect(screen.getByText("擷取區域")).toBeTruthy();
    expect(screen.getByText("擷取目前活動視窗")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "外觀" }));
    expect(screen.getByLabelText("語言")).toBeTruthy();
    expect(screen.getByRole("button", { name: "儲存" })).toBeTruthy();
  });

  it("updates the native settings window title when the language changes", async () => {
    const user = userEvent.setup();
    render(<SettingsRoute />);

    await screen.findByRole("tab", { name: "Appearance" });
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    await user.click(screen.getByLabelText("Language"));
    await user.click(await screen.findByRole("option", { name: "繁體中文" }));

    await waitFor(() => {
      expect(currentWindowMock.setTitle).toHaveBeenCalledWith("Flashot 設定");
    });
  });

  it("keeps rendering when the native window title API is unavailable", async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    vi.mocked(getCurrentWindow).mockImplementationOnce(() => {
      throw new Error("native window unavailable");
    });

    render(<SettingsRoute />);

    expect(await screen.findByRole("tab", { name: "General" })).toBeTruthy();
  });

  it("updates document accent variables from the selected accent color", async () => {
    render(<SettingsRoute />);

    await screen.findByRole("tab", { name: "Appearance" });
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));

    expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe(SELECTION_COLOR);

    fireEvent.click(screen.getByRole("button", { name: "Accent color: Rose" }));

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
    expect(document.documentElement.style.getPropertyValue("--primary")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--ring")).not.toBe("");
  });

  it("updates the document theme class from stored settings", async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...settings, theme: "dark" });

    render(<SettingsRoute />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("keeps the bootstrapped dark theme while settings load", async () => {
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");
    vi.mocked(getSettings).mockReturnValue(new Promise(() => {}));

    render(<SettingsRoute />);

    await waitFor(() => {
      expect(localStorage.getItem("theme")).toBe("dark");
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("uses compact shortcut label icons", async () => {
    render(<SettingsRoute />);

    await screen.findByRole("tab", { name: "Shortcuts" });
    fireEvent.click(screen.getByRole("tab", { name: "Shortcuts" }));
    const label = (await screen.findByText("Capture Area")).closest("label");
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

    fireEvent.click(await screen.findByRole("tab", { name: "Shortcuts" }));
    await screen.findByText("Capture Area");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({
        accentColor: SELECTION_COLOR,
        language: "en",
      }));
    });
  });
});
