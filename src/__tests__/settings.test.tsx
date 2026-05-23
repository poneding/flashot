/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsRoute } from "@/routes/Settings";
import { ThemeSelect } from "@/settings/ThemeSelect";
import { getSettings, setSettings } from "@/lib/ipc";
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
  launchAtLogin: false,
  lastSaveDir: null,
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
});
