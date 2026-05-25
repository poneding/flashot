import { useEffect, type RefObject } from "react";

export function useDismissOnOutsideMouseDown<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T>,
  onDismiss: () => void,
  options?: { ignoreRef?: RefObject<HTMLElement> },
) {
  const ignoreRef = options?.ignoreRef;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ignoreRef?.current?.contains(target)) return;
      if (ref.current && !ref.current.contains(target)) onDismiss();
    };
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [open, ref, onDismiss, ignoreRef]);
}
