/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutRoute } from "@/routes/About";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

describe("AboutRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the app version and repository link", async () => {
    render(<AboutRoute />);

    expect(screen.getByRole("heading", { name: "Flashot" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Version 0.1.0")).toBeTruthy());
    expect(screen.getByRole("button", { name: "GitHub Repository" })).toBeTruthy();
  });
});
