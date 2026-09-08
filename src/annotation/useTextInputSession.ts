import { useEffect, type RefObject } from "react";
import { beginTextInputSession, endTextInputSession } from "@/lib/ipc";
import { useOverlay } from "@/overlay/state";

export function useTextInputSession(input: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const inputId = crypto.randomUUID();
    const sessionId = useOverlay.getState().frameRevision;
    let disposed = false;
    void beginTextInputSession(inputId, sessionId)
      .then(() => { if (!disposed) input.current?.focus(); })
      .catch((error) => console.warn("Failed to prepare text input", error));
    return () => {
      disposed = true;
      void endTextInputSession(inputId, sessionId)
        .catch((error) => console.warn("Failed to restore text input", error));
    };
  }, [input]);
}
