import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";
import { zhTW } from "@/i18n/zh-TW";

export type Locale = "en" | "zh-CN" | "zh-TW";
export type LocalePreference = Locale;

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

export function resolveLocale(
  preference: unknown,
): Locale {
  return preference === "zh-CN" || preference === "zh-TW" || preference === "en"
    ? preference
    : "en";
}

export function createTranslator(locale: Locale) {
  const dictionary = dictionaries[resolveLocale(locale)];
  return (key: string, values: Record<string, string | number> = {}): string => {
    const template = dictionary[key] ?? en[key as keyof typeof en] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      values[name] == null ? `{${name}}` : String(values[name]),
    );
  };
}
