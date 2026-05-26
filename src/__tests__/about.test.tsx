/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutRoute } from "@/routes/About";
import { getSettings } from "@/lib/ipc";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn(),
}));

describe("AboutRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty("--flashot-accent");
    vi.mocked(getSettings).mockResolvedValue({
      captureHotkey: "Cmd+Shift+A",
      fullscreenHotkey: "Cmd+Shift+F",
      activeWindowHotkey: "Cmd+Shift+W",
      theme: "system",
      accentColor: "#F43F5E",
      language: "system",
      launchAtLogin: false,
      lastSaveDir: null,
      cornerRadius: 0,
    });
  });

  it("shows the app version and repository link", async () => {
    render(<AboutRoute />);

    expect(screen.getByRole("heading", { name: "Flashot" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Version 0.1.0")).toBeTruthy());
    expect(screen.getByRole("button", { name: "GitHub Repository" })).toBeTruthy();
  });

  it("shows the app icon below the title and renders the version in mono", async () => {
    const { container } = render(<AboutRoute />);

    const heading = screen.getByRole("heading", { name: "Flashot" });
    const icon = screen.getByRole("img", { name: "Flashot app icon" });
    const version = await screen.findByText("Version 0.1.0");

    expect(icon.getAttribute("src")).toBe("/app-logo.svg");
    expect(heading.compareDocumentPosition(icon)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector(".font-mono")).toBe(version);
  });

  it("keeps the compact about window from showing a vertical scrollbar", async () => {
    const { container } = render(<AboutRoute />);

    const main = container.querySelector("main");

    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("overflow-hidden");
    expect(main?.className).not.toContain("min-h-full");
    await screen.findByText("Version 0.1.0");
  });
  it("applies the saved accent color for primary controls", async () => {
    render(<AboutRoute />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--flashot-accent")).toBe("#F43F5E");
    });
  });

});
