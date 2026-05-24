import { useEffect, type RefObject } from "react";

export function useDismissOnOutsideMouseDown<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [open, ref, onDismiss]);
}
