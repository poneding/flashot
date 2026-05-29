import { useEffect, useRef, useState } from "react";
import {
  MARKER_BUBBLE_BACKGROUND,
  MARKER_BUBBLE_FONT_FAMILY,
  MARKER_BUBBLE_PADDING_X,
  MARKER_BUBBLE_PADDING_Y,
  MARKER_BUBBLE_POINTER_HALF_HEIGHT,
  MARKER_BUBBLE_POINTER_WIDTH,
  MARKER_BUBBLE_RADIUS,
  MARKER_BUBBLE_TEXT_COLOR,
  MARKER_DEFAULT_FONT_SIZE,
  markerBadgeRadius,
  markerBubbleMetrics,
} from "@/annotation/markerStyle";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";
import { beginTextInputSession, endTextInputSession } from "@/lib/ipc";

type Props = {
  object: AnnotationObject;
  selection: Rect;
  onConfirm: (text: string) => void;
  onCancel: () => void;
  viewportOrigin?: { x: number; y: number };
};

export function MarkerTextOverlay({ object, selection, onConfirm, onCancel, viewportOrigin }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirmedRef = useRef(false);
  const composingRef = useRef(false);
  const pendingBlurRef = useRef(false);
  const [textValue, setTextValue] = useState(object.text ?? "");
  const textValueRef = useRef(object.text ?? "");
  const origin = viewportOrigin ?? { x: selection.x, y: selection.y };
  const start = object.start ?? { x: 0, y: 0 };
  const fontSize = object.style.fontSize ?? MARKER_DEFAULT_FONT_SIZE;
  const badgeRadius = markerBadgeRadius(object.style.fontSize);
  const metrics = markerBubbleMetrics(textValue, fontSize, badgeRadius);
  const left = origin.x + start.x + object.transform.x + metrics.bubbleX;
  const top = origin.y + start.y + object.transform.y + metrics.bubbleY;

  const updateTextValue = (value: string) => {
    textValueRef.current = value;
    setTextValue(value);
  };

  useEffect(() => {
    beginTextInputSession().catch((error) => {
      console.warn("Failed to prepare marker text input session", error);
    });
    return () => {
      endTextInputSession().catch((error) => {
        console.warn("Failed to restore marker text input session", error);
      });
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.setSelectionRange(el.value.length, el.value.length);
    setTimeout(() => el.focus(), 0);
  }, []);

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    onConfirm((textValueRef.current ?? "").trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (composingRef.current || e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  const handleBlur = () => {
    if (composingRef.current) {
      pendingBlurRef.current = true;
      return;
    }
    confirm();
  };

  const markerX = origin.x + start.x + object.transform.x;
  const markerY = origin.y + start.y + object.transform.y;

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: markerX + metrics.bubbleX - MARKER_BUBBLE_POINTER_WIDTH,
          top: markerY - MARKER_BUBBLE_POINTER_HALF_HEIGHT,
          zIndex: 10001,
          width: 0,
          height: 0,
          pointerEvents: "none",
          borderTop: `${MARKER_BUBBLE_POINTER_HALF_HEIGHT}px solid transparent`,
          borderBottom: `${MARKER_BUBBLE_POINTER_HALF_HEIGHT}px solid transparent`,
          borderRight: `${MARKER_BUBBLE_POINTER_WIDTH}px solid ${MARKER_BUBBLE_BACKGROUND}`,
        }}
      />
      <textarea
        ref={textareaRef}
        rows={1}
        wrap="off"
        value={textValue}
        spellCheck={false}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left,
          top,
          zIndex: 10002,
          pointerEvents: "auto",
          boxSizing: "border-box",
          width: metrics.bubbleWidth,
          height: metrics.bubbleHeight,
          padding: `${MARKER_BUBBLE_PADDING_Y}px ${MARKER_BUBBLE_PADDING_X}px`,
          margin: 0,
          border: "none",
          borderRadius: MARKER_BUBBLE_RADIUS,
          background: MARKER_BUBBLE_BACKGROUND,
          color: MARKER_BUBBLE_TEXT_COLOR,
          fontSize,
          fontFamily: MARKER_BUBBLE_FONT_FAMILY,
          lineHeight: `${metrics.lineHeight}px`,
          outline: "none",
          overflow: "hidden",
          resize: "none",
          caretColor: MARKER_BUBBLE_TEXT_COLOR,
          whiteSpace: "pre",
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onChange={(event) => updateTextValue(event.currentTarget.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          if (pendingBlurRef.current) {
            pendingBlurRef.current = false;
            setTimeout(() => confirm(), 0);
          }
        }}
      />
    </>
  );
}
