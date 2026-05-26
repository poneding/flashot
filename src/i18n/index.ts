import { en } from "@/i18n/en";
import { zhCN } from "@/i18n/zh-CN";

export type Locale = "en" | "zh-CN";
export type LocalePreference = Locale | "system";

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
};

function normalizeLocaleTag(tag: string): Locale | null {
  const lower = tag.toLowerCase();
  if (lower === "zh-cn" || lower.startsWith("zh-hans") || lower.startsWith("zh")) {
    return "zh-CN";
  }
  if (lower.startsWith("en")) return "en";
  return null;
}

export function resolveLocale(
  preference: LocalePreference,
  systemLanguages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): Locale {
  if (preference !== "system") return preference;

  for (const language of systemLanguages) {
    const locale = normalizeLocaleTag(language);
    if (locale) return locale;
  }

  return "en";
}

export function createTranslator(locale: Locale) {
  const dictionary = dictionaries[locale];
  return (key: string): string => dictionary[key] ?? en[key as keyof typeof en] ?? key;
}
