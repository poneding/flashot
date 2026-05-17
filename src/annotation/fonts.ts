import type { AnnotationStyle } from "@/annotation/types";

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
  return normalized;
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
