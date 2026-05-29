/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox", () => {
  it("uses the configured accent color for its checked state", () => {
    render(<Checkbox checked aria-label="Accent checkbox" />);

    const checkbox = screen.getByRole("checkbox", { name: "Accent checkbox" });
    const styles = readFileSync("src/styles/globals.css", "utf8");

    expect(checkbox.hasAttribute("data-checked")).toBe(true);
    expect(styles).toContain('[data-slot="checkbox"][data-checked]');
    expect(styles).toContain("background-color: var(--flashot-accent)");
    expect(styles).toContain("border-color: var(--flashot-accent)");
    expect(checkbox.className).not.toContain("data-checked:bg-primary");
  });
});
