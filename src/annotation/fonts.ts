import type { AnnotationStyle } from "@/annotation/types";
import { listSystemFonts } from "@/lib/ipc";

export const HANDWRITING_FONT_VALUE = "handwriting";
export const HANDWRITING_FONT_FAMILY = '"Excalifont", "Xiaolai SC", sans-serif, "Segoe UI Emoji"';
export const TEXT_LINE_HEIGHT = 1.25;

const LEGACY_HANDWRITING_VALUES = new Set([
  HANDWRITING_FONT_VALUE,
  "Excalifont",
  "Xiaolai SC",
  "LXGW WenKai Screen",
  HANDWRITING_FONT_FAMILY,
]);

const GENERIC_FONT_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"]);
const HANDWRITING_LOAD_FAMILIES = ["Excalifont", "Xiaolai SC"];

let cachedFonts: string[] | null = null;

// Common fonts that should always be included if available
const COMMON_FONTS = new Set([
  // Sans-serif
  "Arial", "Helvetica", "Helvetica Neue", "Verdana", "Tahoma", "Trebuchet MS",
  "Segoe UI", "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans Pro",
  "Noto Sans", "Ubuntu", "Cantarell", "DejaVu Sans", "Liberation Sans",
  // Serif
  "Times New Roman", "Times", "Georgia", "Garamond", "Palatino", "Baskerville",
  "Cambria", "Noto Serif", "DejaVu Serif", "Liberation Serif",
  // Monospace
  "Courier New", "Courier", "Monaco", "Consolas", "Menlo", "Source Code Pro",
  "Fira Code", "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono",
  // Chinese
  "PingFang SC", "PingFang TC", "Microsoft YaHei", "SimHei", "SimSun", "STHeiti",
  "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei",
  // Japanese
  "Hiragino Kaku Gothic Pro", "Hiragino Sans", "Yu Gothic", "Meiryo",
  "Noto Sans CJK JP", "Source Han Sans JP",
  // Korean
  "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Source Han Sans KR",
]);

// Patterns to filter out system/icon/symbol fonts
const EXCLUDE_PATTERNS = [
  /^\./, // Hidden fonts starting with dot
  /icon/i, // Icon fonts
  /symbol/i, // Symbol fonts
  /emoji/i, // Emoji fonts (except in handwriting)
  /webdings/i, // Webdings
  /wingdings/i, // Wingdings
  /zapf\s*dingbats/i, // Zapf Dingbats
  /marlett/i, // Marlett
  /^MT\s+Extra/i, // MT Extra
  /^Apple\s+Color\s+Emoji/i,
  /^Segoe\s+UI\s+Emoji/i,
  /^Segoe\s+UI\s+Symbol/i,
  /^Noto\s+Color\s+Emoji/i,
  /^Noto\s+Emoji/i,
  /LastResort/i, // Last Resort font
  /^\.SF/i, // SF system fonts (internal)
];

function shouldIncludeFont(fontName: string): boolean {
  // Always include common fonts
  if (COMMON_FONTS.has(fontName)) return true;

  // Exclude fonts matching patterns
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(fontName))) return false;

  // Exclude fonts with too many special characters (likely system fonts)
  const specialCharCount = (fontName.match(/[^a-zA-Z0-9\s\-]/g) || []).length;
  if (specialCharCount > 2) return false;

  return true;
}

export async function getSystemFonts(): Promise<string[]> {
  if (cachedFonts) return cachedFonts;
  const allFonts = await listSystemFonts();
  cachedFonts = allFonts.filter(shouldIncludeFont);
  return cachedFonts;
}

function quoteFontFamily(fontFamily: string): string {
  if (/^["'].*["']$/.test(fontFamily)) return fontFamily;
  return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

export function normalizeTextFontFamilyValue(fontFamily?: string): string {
  if (!fontFamily || LEGACY_HANDWRITING_VALUES.has(fontFamily)) return HANDWRITING_FONT_VALUE;
  return fontFamily;
}

export function normalizeTextStyle(style: AnnotationStyle): AnnotationStyle {
  return {
    ...style,
    fontFamily: normalizeTextFontFamilyValue(style.fontFamily),
  };
}

export function resolveTextFontFamily(fontFamily?: string): string {
  const normalized = normalizeTextFontFamilyValue(fontFamily);
  if (normalized === HANDWRITING_FONT_VALUE) return HANDWRITING_FONT_FAMILY;
  if (GENERIC_FONT_FAMILIES.has(normalized)) return normalized;
  return `"${normalized}", sans-serif`;
}

export function textEditorHeight(fontSize: number): number {
  return Math.ceil(fontSize * TEXT_LINE_HEIGHT);
}

export function textHotspotOffset(fontSize: number): number {
  return Math.round(fontSize * 0.5);
}

export function textFontLoadDescriptors(fontSize: number, fontFamily: string | undefined, text: string): Array<{ descriptor: string; text: string }> {
  const normalized = normalizeTextFontFamilyValue(fontFamily);
  if (normalized === HANDWRITING_FONT_VALUE) {
    return HANDWRITING_LOAD_FAMILIES.map((family) => ({
      descriptor: `${fontSize}px ${quoteFontFamily(family)}`,
      text,
    }));
  }
  if (GENERIC_FONT_FAMILIES.has(normalized)) return [];
  return [{ descriptor: `${fontSize}px ${quoteFontFamily(normalized)}`, text }];
}
