import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readme = () => readFileSync(resolve(__dirname, "../../README.md"), "utf8");

describe("README V0 alignment", () => {
  it("documents the confirmed default shortcuts and copy shortcut", () => {
    const text = readme();

    expect(text).toContain("Cmd+Shift+A");
    expect(text).toContain("Ctrl+Shift+A");
    expect(text).toContain("Cmd+Shift+F");
    expect(text).toContain("Ctrl+Shift+F");
    expect(text).toContain("Cmd+Shift+W");
    expect(text).toContain("Ctrl+Shift+W");
    expect(text).toContain("Cmd/Ctrl+C");
    expect(text).not.toContain("CommandOrControl");
  });

  it("keeps Linux out of the V0 install path", () => {
    const text = readme();

    expect(text).not.toContain("### Linux");
    expect(text).not.toContain("Wayland support is experimental");
  });
});
