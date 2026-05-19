import type { AnnotationStyle } from "@/annotation/types";
import { listSystemFonts } from "@/lib/ipc";

export const SYSTEM_FONT_VALUE = "system-ui";
export const TEXT_LINE_HEIGHT = 1.25;

export function getSystemFontDisplayName(): string {
  const platform = navigator.platform?.toLowerCase() ?? "";
  if (platform.includes("mac")) return "SF Pro";
  if (platform.includes("win")) return "Segoe UI";
  return "System";
}

export function resolveSystemFont(): string {
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
}

const LEGACY_HANDWRITING_VALUES = new Set([
  "handwriting",
  "Excalifont",
  "Xiaolai SC",
  "LXGW WenKai Screen",
  '"Excalifont", "Xiaolai SC", sans-serif, "Segoe UI Emoji"',
]);

const GENERIC_FONT_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"]);

let cachedFonts: string[] | null = null;

const COMMON_FONTS = new Set([
  "Arial", "Helvetica", "Helvetica Neue", "Verdana", "Tahoma", "Trebuchet MS",
  "Segoe UI", "Roboto", "Open Sans", "Lato", "Montserrat", "Source Sans Pro",
  "Noto Sans", "Ubuntu", "Cantarell", "DejaVu Sans", "Liberation Sans",
  "Times New Roman", "Times", "Georgia", "Garamond", "Palatino", "Baskerville",
  "Cambria", "Noto Serif", "DejaVu Serif", "Liberation Serif",
  "Courier New", "Courier", "Monaco", "Consolas", "Menlo", "Source Code Pro",
  "Fira Code", "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono",
  "PingFang SC", "PingFang TC", "Microsoft YaHei", "SimHei", "SimSun", "STHeiti",
  "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei",
  "Hiragino Kaku Gothic Pro", "Hiragino Sans", "Yu Gothic", "Meiryo",
  "Noto Sans CJK JP", "Source Han Sans JP",
  "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Source Han Sans KR",
]);

const EXCLUDE_PATTERNS = [
  /^\./,
  /icon/i,
  /symbol/i,
  /emoji/i,
  /webdings/i,
  /wingdings/i,
  /zapf\s*dingbats/i,
  /marlett/i,
  /^MT\s+Extra/i,
  /^Apple\s+Color\s+Emoji/i,
  /^Segoe\s+UI\s+Emoji/i,
  /^Segoe\s+UI\s+Symbol/i,
  /^Noto\s+Color\s+Emoji/i,
  /^Noto\s+Emoji/i,
  /LastResort/i,
  /^\.SF/i,
];

function shouldIncludeFont(fontName: string): boolean {
  if (COMMON_FONTS.has(fontName)) return true;
  if (EXCLUDE_PATTERNS.some(pattern => pattern.test(fontName))) return false;
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
  if (!fontFamily || LEGACY_HANDWRITING_VALUES.has(fontFamily)) return SYSTEM_FONT_VALUE;
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
  if (normalized === SYSTEM_FONT_VALUE) return resolveSystemFont();
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
  if (normalized === SYSTEM_FONT_VALUE || GENERIC_FONT_FAMILIES.has(normalized)) return [];
  return [{ descriptor: `${fontSize}px ${quoteFontFamily(normalized)}`, text }];
}
