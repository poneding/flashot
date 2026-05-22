import { describe, it, expect } from "vitest";
import { formatColorText } from "@/overlay/ColorPicker";

describe("ColorPicker format conversion", () => {
  it("converts RGB to HEX format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "hex")).toBe("#FF5A2E");
  });

  it("converts RGB to RGB string format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "rgb")).toBe("rgb(255,90,46)");
  });

  it("handles black color", () => {
    const color = { r: 0, g: 0, b: 0 };
    expect(formatColorText(color, "hex")).toBe("#000000");
    expect(formatColorText(color, "rgb")).toBe("rgb(0,0,0)");
  });

  it("handles white color", () => {
    const color = { r: 255, g: 255, b: 255 };
    expect(formatColorText(color, "hex")).toBe("#FFFFFF");
    expect(formatColorText(color, "rgb")).toBe("rgb(255,255,255)");
  });
});
