// Default accent used for selection borders, window-detect highlights,
// crosshair, and the pin window glow.
export const SELECTION_COLOR = "#F59E0B";
export const ACCENT_COLOR_CSS_VAR = "var(--flashot-accent)";
export const ACCENT_RGB_CSS_VAR = "var(--flashot-accent-rgb)";
export const ACCENT_SOFT_CSS_VAR = "var(--flashot-accent-soft)";


type Rgb = { r: number; g: number; b: number };

function parseHexColor(value: string): Rgb | null {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHslTriplet({ r, g, b }: Rgb): string {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return `0 0% ${Math.round(lightness * 100)}%`;

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue = 0;

  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  if (max === green) hue = (blue - red) / delta + 2;
  if (max === blue) hue = (red - green) / delta + 4;

  return `${Math.round(hue * 60)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function normalizeHexColor(value: string): string {
  const rgb = parseHexColor(value) ?? parseHexColor(SELECTION_COLOR)!;
  const hex = [rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `#${hex}`;
}

export function accentCssVariables(color: string): Record<string, string> {
  const normalized = normalizeHexColor(color);
  const rgb = parseHexColor(normalized)!;
  const rgbTriplet = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  const hslTriplet = rgbToHslTriplet(rgb);

  return {
    "--flashot-accent": normalized,
    "--flashot-accent-rgb": rgbTriplet,
    "--flashot-accent-soft": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.06)`,
    "--accent": hslTriplet,
    "--primary": hslTriplet,
    "--ring": hslTriplet,
  };
}

export function applyAccentColor(color: string, root?: HTMLElement): void {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;

  for (const [name, value] of Object.entries(accentCssVariables(color))) {
    target.style.setProperty(name, value);
  }
}
