import { useEffect, useRef, type CSSProperties } from "react";
import { useAnnotation } from "@/annotation/store";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";

type Props = {
  position: { x: number; y: number };
  selection: Rect;
  onConfirm: (obj: AnnotationObject) => void;
  onCancel: () => void;
  editingObject?: AnnotationObject | null;
};

export function TextOverlay({ position, selection, onConfirm, onCancel, editingObject }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { activeStyle } = useAnnotation.getState();
  const style = editingObject?.style ?? activeStyle;
  const initialText = editingObject?.text ?? "";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.value = initialText;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
    }
  };

  const handleBlur = () => { confirm(); };

  const confirm = () => {
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
    position: "absolute",
    left: position.x,
    top: position.y,
    zIndex: 10000,
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
