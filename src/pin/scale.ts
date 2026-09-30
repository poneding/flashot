export const PIN_SCALE_MIN = 0.5;
export const PIN_SCALE_MAX = 3;
export const PIN_SCALE_STEP = 0.05;

export function clampPinScale(scale: number): number {
  return Math.round(Math.max(PIN_SCALE_MIN, Math.min(PIN_SCALE_MAX, scale)) * 100) / 100;
}

export function pinScaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function pinScaleOptions(): number[] {
  const count = Math.round((PIN_SCALE_MAX - PIN_SCALE_MIN) / PIN_SCALE_STEP) + 1;
  return Array.from({ length: count }, (_, i) => clampPinScale(PIN_SCALE_MIN + i * PIN_SCALE_STEP));
}

export function isPinTextInput(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement || (element instanceof HTMLElement && element.isContentEditable);
}
