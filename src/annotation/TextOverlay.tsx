import { useEffect, useRef, type MutableRefObject } from "react";
import {
  normalizeTextStyle,
  resolveTextFontFamily,
  TEXT_LINE_HEIGHT,
  textEditorHeight,
  textHotspotOffset,
} from "@/annotation/fonts";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";
import { useTextInputSession } from "@/annotation/useTextInputSession";

type Props = {
  position: { x: number; y: number };
  selection: Rect;
  onConfirm: (obj: AnnotationObject) => void;
  onCancel: () => void;
  editingObject?: AnnotationObject | null;
  flushRef?: MutableRefObject<(() => void) | null>;
  viewportOrigin?: { x: number; y: number };
  displayScale?: number;
};

export function TextOverlay({ position, selection, onConfirm, onCancel, editingObject, flushRef, viewportOrigin, displayScale = 1 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeStyle } = useAnnotation.getState();
  const style = normalizeTextStyle(editingObject?.style ?? activeStyle);
  const initialText = editingObject?.text ?? "";
  const confirmedRef = useRef(false);
  const composingRef = useRef(false);
  const pendingBlurRef = useRef(false);
  const fontSize = (style.fontSize ?? 24) * displayScale;
  const editorHeight = textEditorHeight(fontSize);
  const fontFamily = resolveTextFontFamily(style.fontFamily);
  const origin = viewportOrigin ?? { x: selection.x, y: selection.y };
  const editorPosition = editingObject?.start
    ? {
        x: origin.x + (editingObject.start.x + editingObject.transform.x) * displayScale,
        y: origin.y + (editingObject.start.y + editingObject.transform.y) * displayScale,
      }
    : {
        x: position.x,
        y: position.y - textHotspotOffset(fontSize),
      };

  useTextInputSession(textareaRef);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (initialText) {
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, editorHeight) + "px";
      el.setSelectionRange(initialText.length, initialText.length);
    }
  }, []);

  useEffect(() => {
    if (flushRef) {
      flushRef.current = () => confirm();
    }
    return () => {
      if (flushRef) flushRef.current = null;
    };
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (composingRef.current || e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      confirmedRef.current = true;
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

  const resizeToContent = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.max(el.scrollHeight, editorHeight) + "px";
  };

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    const raw = textareaRef.current?.value ?? "";
    const text = raw.trim();
    if (!text) { onCancel(); return; }
    const obj: AnnotationObject = {
      id: editingObject?.id ?? crypto.randomUUID(),
      type: "text",
      start: editingObject?.start ?? { x: (editorPosition.x - origin.x) / displayScale, y: (editorPosition.y - origin.y) / displayScale },
      text,
      style: { ...style },
      transform: editingObject?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    onConfirm(obj);
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      defaultValue={initialText}
      spellCheck={false}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: editorPosition.x,
        top: editorPosition.y,
        zIndex: 10002,
        pointerEvents: "auto",
        display: "block",
        boxSizing: "border-box",
        width: 400,
        height: editorHeight,
        padding: 0,
        margin: 0,
        border: "none",
        background: "transparent",
        appearance: "none",
        color: style.color,
        fontSize,
        fontFamily,
        lineHeight: TEXT_LINE_HEIGHT,
        outline: "none",
        overflow: "hidden",
        resize: "none",
        caretColor: style.color,
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        resizeToContent(e.currentTarget);
        if (pendingBlurRef.current) {
          pendingBlurRef.current = false;
          setTimeout(() => confirm(), 0);
        }
      }}
      onInput={(e) => {
        resizeToContent(e.currentTarget);
      }}
    />
  );
}
