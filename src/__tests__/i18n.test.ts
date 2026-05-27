import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale } from "@/i18n";

describe("i18n", () => {
  it("translates known settings keys in English and Simplified Chinese", () => {
    expect(createTranslator("en")("settings.shortcuts.title")).toBe("Shortcuts");
    expect(createTranslator("zh-CN")("settings.shortcuts.title")).toBe("快捷键");
  });

  it("translates Chinese theme labels and falls back to the key for missing translations", () => {
    expect(createTranslator("zh-CN")("settings.theme.system")).toBe("跟随系统");
    expect(createTranslator("zh-CN")("settings.missing.key")).toBe("settings.missing.key");
  });

  it("resolves system locale from browser languages", () => {
    expect(resolveLocale("system", ["zh-CN", "en-US"])).toBe("zh-CN");
    expect(resolveLocale("system", ["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveLocale("system", ["fr-FR"])).toBe("en");
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
  });
});
