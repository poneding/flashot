import { useEffect } from "react";

export function CaptureFocusRoute() {
  useEffect(() => {
    document.body.classList.add("capture-focus");
    return () => {
      document.body.classList.remove("capture-focus");
    };
  }, []);

  return null;
}
