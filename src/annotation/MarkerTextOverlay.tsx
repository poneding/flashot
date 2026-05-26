import { useEffect, useRef } from "react";
import type { AnnotationObject } from "@/annotation/types";
import type { Rect } from "@/lib/types";
import { beginTextInputSession, endTextInputSession } from "@/lib/ipc";

type Props = {
  object: AnnotationObject;
  selection: Rect;
  onConfirm: (text: string) => void;
  onCancel: () => void;
};

function markerTextColor(object: AnnotationObject): string {
  return object.style.markerTextColor ?? "#ffffff";
}

function markerBubbleFill(object: AnnotationObject): string {
  return object.style.markerBubbleFill ?? "#111827";
}

function markerBorderColor(object: AnnotationObject): string {
  return object.style.markerFill ?? object.style.color;
}

export function MarkerTextOverlay({ object, selection, onConfirm, onCancel }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const confirmedRef = useRef(false);
  const composingRef = useRef(false);
  const pendingBlurRef = useRef(false);
  const start = object.start ?? { x: 0, y: 0 };
  const left = selection.x + start.x + object.transform.x + 22;
  const top = selection.y + start.y + object.transform.y - 13;

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
    onConfirm((textareaRef.current?.value ?? "").trim());
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

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      defaultValue={object.text ?? ""}
      spellCheck={false}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 10002,
        pointerEvents: "auto",
        boxSizing: "border-box",
        width: 220,
        height: 26,
        padding: "3px 8px",
        margin: 0,
        border: `1px solid ${markerBorderColor(object)}`,
        borderRadius: 7,
        background: markerBubbleFill(object),
        color: markerTextColor(object),
        fontSize: 14,
        lineHeight: "18px",
        outline: "none",
        overflow: "hidden",
        resize: "none",
        caretColor: markerTextColor(object),
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
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
  );
}
