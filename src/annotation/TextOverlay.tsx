import { useEffect, useRef, type CSSProperties, type MutableRefObject } from "react";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";

type Props = {
  position: { x: number; y: number };
  selection: Rect;
  onConfirm: (obj: AnnotationObject) => void;
  onCancel: () => void;
  editingObject?: AnnotationObject | null;
  flushRef?: MutableRefObject<(() => void) | null>;
};

export function TextOverlay({ position, selection, onConfirm, onCancel, editingObject, flushRef }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeStyle } = useAnnotation.getState();
  const style = editingObject?.style ?? activeStyle;
  const initialText = editingObject?.text ?? "";
  const confirmedRef = useRef(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Delay focus to next frame to avoid being stolen by mousedown
    requestAnimationFrame(() => {
      el.focus();
      el.value = initialText;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    });
  }, []);

  // Register flush callback so Stage can confirm text before opening a new one
  useEffect(() => {
    if (flushRef) {
      flushRef.current = () => confirm();
    }
    return () => {
      if (flushRef) flushRef.current = null;
    };
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  const handleBlur = () => { confirm(); };

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    const text = textareaRef.current?.value?.trim();
    if (!text) { onCancel(); return; }
    const obj: AnnotationObject = {
      id: editingObject?.id ?? crypto.randomUUID(),
      type: "text",
      start: { x: position.x - selection.x, y: position.y - selection.y },
      text,
      style: { ...style },
      transform: editingObject?.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    };
    onConfirm(obj);
  };

  const containerStyle: CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    zIndex: 10002,
    pointerEvents: "auto",
  };

  const textareaStyle: CSSProperties = {
    minWidth: 100,
    minHeight: style.fontSize ?? 24,
    padding: 4,
    border: "2px solid #0099ff",
    borderRadius: 4,
    background: "transparent",
    color: style.color,
    fontSize: style.fontSize ?? 24,
    fontFamily: style.fontFamily ?? "Excalifont",
    lineHeight: 1.4,
    outline: "none",
    resize: "none",
    overflow: "hidden",
  };

  return (
    <div style={containerStyle} onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        style={textareaStyle}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        }}
      />
    </div>
  );
}
