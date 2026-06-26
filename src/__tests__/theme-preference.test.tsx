/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySystemThemePreference,
  applyThemePreference,
  useThemePreference,
} from "@/settings/useStoredAccentColor";

const currentWindowMock = vi.hoisted(() => ({
  theme: vi.fn().mockResolvedValue(null as "light" | "dark" | null),
  onThemeChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => currentWindowMock),
}));

function createMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: vi.fn(),
    emit(nextMatches: boolean) {
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent);
      }
    },
  };
}

function ThemeProbe({ theme }: { theme: "system" | "light" | "dark" }) {
  useThemePreference(theme);
  return null;
}

describe("useThemePreference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("color-scheme");
    currentWindowMock.theme.mockResolvedValue(null);
    currentWindowMock.onThemeChanged.mockResolvedValue(vi.fn());
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => createMatchMedia(false)),
    });
  });

  it("prefers the native window theme when following system appearance", async () => {
    currentWindowMock.theme.mockResolvedValue("dark");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => createMatchMedia(false)),
    });

    await applySystemThemePreference();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("system");
  });

  it("resyncs the document theme when the OS theme changes while following system", async () => {
    const media = createMatchMedia(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => media),
    });

    render(<ThemeProbe theme="system" />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    await act(async () => {
      currentWindowMock.theme.mockResolvedValue("dark");
      media.emit(true);
    });

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
  });

  it("does not react to OS theme changes when an explicit theme is selected", async () => {
    const media = createMatchMedia(false);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => media),
    });

    applyThemePreference("dark");
    render(<ThemeProbe theme="dark" />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    await act(async () => {
      media.emit(false);
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
