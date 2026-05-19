import { describe, expect, it } from "vitest";
import {
  SYSTEM_FONT_VALUE,
  resolveTextFontFamily,
  getSystemFontDisplayName,
  normalizeTextFontFamilyValue,
} from "@/annotation/fonts";

describe("font assets", () => {
  it("resolves system-ui to platform font stack", () => {
    const resolved = resolveTextFontFamily(SYSTEM_FONT_VALUE);
    expect(resolved).toContain("sans-serif");
  });

  it("returns a platform-specific system font display name", () => {
    const name = getSystemFontDisplayName();
    expect(["SF Pro", "Segoe UI", "System"]).toContain(name);
  });

  it("normalizes legacy handwriting values to system-ui", () => {
    expect(normalizeTextFontFamilyValue("handwriting")).toBe(SYSTEM_FONT_VALUE);
    expect(normalizeTextFontFamilyValue("Excalifont")).toBe(SYSTEM_FONT_VALUE);
    expect(normalizeTextFontFamilyValue("Xiaolai SC")).toBe(SYSTEM_FONT_VALUE);
    expect(normalizeTextFontFamilyValue(undefined)).toBe(SYSTEM_FONT_VALUE);
  });

  it("preserves explicit font family values", () => {
    expect(normalizeTextFontFamilyValue("Arial")).toBe("Arial");
    expect(normalizeTextFontFamilyValue("PingFang SC")).toBe("PingFang SC");
  });
});
