/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SELECTION_COLOR } from "@/lib/colors";
import { AccentColorSelect } from "@/settings/AccentColorSelect";

describe("AccentColorSelect", () => {
  it("shows amber first and uses it as the default accent", () => {
    render(<AccentColorSelect value={SELECTION_COLOR} onChange={vi.fn()} />);

    const options = screen.getAllByRole("button");

    expect(SELECTION_COLOR).toBe("#F59E0B");
    expect(options[0].getAttribute("aria-label")).toBe("Accent color: Amber");
    expect(options[0].querySelector("span")?.style.backgroundColor).toBe("rgb(245, 158, 11)");
  });
});
