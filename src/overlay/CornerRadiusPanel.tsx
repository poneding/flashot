import { createTranslator, type Locale } from "@/i18n";
import { scrollSelectedOptionIntoView } from "@/lib/scrollSelectedOptionIntoView";
import { useDismissOnOutsideMouseDown } from "@/lib/useDismissOnOutsideMouseDown";
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";

const PANEL_BACKGROUND = "rgba(30, 30, 30, 0.95)";
const CORNER_RADIUS_OPTIONS = Array.from({ length: 61 }, (_, index) => index);
const CORNER_RADIUS_PANEL_PADDING = 4;
const CORNER_RADIUS_PANEL_BORDER_WIDTH = 1;
const CORNER_RADIUS_MENU_MIN_WIDTH = 54;
const CORNER_RADIUS_LIST_MAX_HEIGHT = 200;
export const CORNER_RADIUS_PANEL_SIZE = {
  width: CORNER_RADIUS_MENU_MIN_WIDTH + CORNER_RADIUS_PANEL_PADDING * 2 + CORNER_RADIUS_PANEL_BORDER_WIDTH * 2,
  height: CORNER_RADIUS_LIST_MAX_HEIGHT + CORNER_RADIUS_PANEL_PADDING * 2 + CORNER_RADIUS_PANEL_BORDER_WIDTH * 2,
} as const;
const DARK_SCROLLBAR_STYLE: CSSProperties = {
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255, 255, 255, 0.32) rgba(255, 255, 255, 0.08)",
  colorScheme: "dark",
  background: PANEL_BACKGROUND,
  borderRadius: 4,
};

type Props = {
  panelRef: RefObject<HTMLDivElement>;
  value: number;
  onChange: (n: number) => void;
  onDismiss: () => void;
  ignoreDismissRef?: RefObject<HTMLElement>;
  style?: CSSProperties;
  locale?: Locale;
};

export function CornerRadiusPanel({ panelRef, value, onChange, onDismiss, ignoreDismissRef, style, locale = "en" }: Props) {
  useDismissOnOutsideMouseDown(true, panelRef, onDismiss, { ignoreRef: ignoreDismissRef });
  const listRef = useRef<HTMLDivElement>(null);
  const t = createTranslator(locale);

  useLayoutEffect(() => {
    scrollSelectedOptionIntoView(listRef.current);
  }, [value]);

  return (
    <div
      ref={panelRef}
      data-corner-radius-panel
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        alignItems: "center",
        boxSizing: "border-box",
        padding: CORNER_RADIUS_PANEL_PADDING,
        borderRadius: 6,
        background: PANEL_BACKGROUND,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        border: `${CORNER_RADIUS_PANEL_BORDER_WIDTH}px solid rgba(255,255,255,0.1)`,
        color: "rgba(255,255,255,0.85)",
        fontSize: 12,
        userSelect: "none",
        zIndex: 10001,
        ...style,
        width: "max-content",
        minWidth: CORNER_RADIUS_PANEL_SIZE.width,
      }}
    >
      <div
        ref={listRef}
        data-testid="screenshot-corner-radius-list"
        className="flashot-dark-scrollbar"
        style={{
          maxHeight: CORNER_RADIUS_LIST_MAX_HEIGHT,
          overflowY: "auto",
          overflowX: "hidden",
          width: "max-content",
          minWidth: CORNER_RADIUS_MENU_MIN_WIDTH,
          ...DARK_SCROLLBAR_STYLE,
        }}
      >
        {CORNER_RADIUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={t("screenshot.cornerRadius", { value: option })}
            data-selected={option === value ? "true" : undefined}
            onClick={() => {
              onChange(option);
              onDismiss();
            }}
            style={{
              border: "none",
              cursor: "pointer",
              borderRadius: 5,
              height: 22,
              boxSizing: "border-box",
              padding: "3px 6px",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              color: "#fff",
              background: option === value ? "rgba(255,255,255,0.15)" : "transparent",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
