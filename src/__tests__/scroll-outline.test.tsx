/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollOutlineRoute } from "@/routes/ScrollOutline";

vi.mock("@/lib/ipc", () => ({
  getSettings: vi.fn().mockResolvedValue({
    language: "en",
    theme: "system",
    accentColor: "#4ED1FF",
  }),
  onSettingsChanged: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("ScrollOutlineRoute", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an opaque accent strip for wayland scroll outlines", () => {
    const { container } = render(<ScrollOutlineRoute />);
    const outline = container.firstElementChild as HTMLElement;

    expect(outline.style.background).toBe("var(--flashot-accent)");
    expect(outline.style.position).toBe("fixed");
  });
});
