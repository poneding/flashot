import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale } from "@/i18n";
import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import { zhTW } from "@/i18n/zh-TW";

describe("i18n", () => {
  it("translates known settings keys in English, Simplified Chinese, and Traditional Chinese", () => {
    expect(createTranslator("en")("settings.shortcuts.title")).toBe("Shortcuts");
    expect(createTranslator("zh-CN")("settings.shortcuts.title")).toBe("快捷键");
    expect(createTranslator("zh-TW")("settings.shortcuts.title")).toBe("快速鍵");
  });

  it("uses precise shortcut action copy in every locale", () => {
    expect(createTranslator("en")("settings.shortcut.region")).toBe("Capture Area");
    expect(createTranslator("en")("settings.shortcut.window")).toBe("Capture Active Window");
    expect(createTranslator("zh-CN")("settings.shortcut.region")).toBe("截取区域");
    expect(createTranslator("zh-CN")("settings.shortcut.window")).toBe("截取当前活动窗口");
    expect(createTranslator("zh-TW")("settings.shortcut.region")).toBe("擷取區域");
    expect(createTranslator("zh-TW")("settings.shortcut.window")).toBe("擷取目前活動視窗");
  });

  it("translates image adjustment reset copy in every locale", () => {
    expect(createTranslator("en")("imageAdjustments.reset")).toBe("Reset");
    expect(createTranslator("zh-CN")("imageAdjustments.reset")).toBe("重置");
    expect(createTranslator("zh-TW")("imageAdjustments.reset")).toBe("重設");
  });

  it("keeps every non-English dictionary aligned with English keys", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(en).sort());
  });

  it("translates Chinese theme labels and falls back to the key for missing translations", () => {
    expect(createTranslator("zh-CN")("settings.theme.system")).toBe("跟随系统");
    expect(createTranslator("zh-CN")("settings.missing.key")).toBe("settings.missing.key");
  });

  it("defaults legacy system language preferences to English", () => {
    expect(resolveLocale("system")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("zh-TW")).toBe("zh-TW");
  });
});
