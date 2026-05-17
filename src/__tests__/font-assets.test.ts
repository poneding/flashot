import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("font assets", () => {
  it("ships Excalifont as a valid WOFF2 file", () => {
    const font = readFileSync("public/fonts/Excalifont.woff2");

    expect(font.subarray(0, 4).toString("ascii")).toBe("wOF2");
  });

  it("ships a bundled Chinese handwriting webfont", () => {
    const css = readFileSync("node_modules/cn-fontsource-xiaolai-sc-regular/font.css", "utf8");

    expect(css).toContain("Xiaolai SC");
    expect(css).toContain(".woff2");
  });
});
