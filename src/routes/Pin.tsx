import { closePin, setPinScale } from "@/lib/ipc";
import { SELECTION_COLOR } from "@/lib/colors";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appCacheDir } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState, type CSSProperties } from "react";

// Soft outer glow around the pinned image. The window itself reserves
// PIN_SHADOW_PADDING px on each side (matched in commands.rs) so these
// shadows have room to render without being clipped by the window edge.
const PIN_SHADOW_PADDING = 24;
const PIN_GLOW = [
  // Tight rim — barely-there definition right at the image edge.
  `0 0 1px ${SELECTION_COLOR}99`,
  // Inner halo — most of the visible color.
  `0 0 6px ${SELECTION_COLOR}80`,
  // Mid bloom.
  `0 0 14px ${SELECTION_COLOR}55`,
  // Outer feathered fall-off.
  `0 0 22px ${SELECTION_COLOR}33`,
].join(", ");

function parsePinId(): string | null {
  const h = window.location.hash || "";
  const prefix = "#/pin/";
  if (!h.startsWith(prefix)) return null;
  const rest = h.slice(prefix.length);
  // Strip any trailing query/hash fragments just in case.
  const id = rest.split(/[/?#]/)[0];
  return id || null;
}

export function PinRoute() {
  const [id] = useState<string | null>(() => parsePinId());
  const [scale, setScale] = useState(1.0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("pin");
    return () => {
      document.body.classList.remove("pin");
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const cacheDir = await appCacheDir();
        const sep = cacheDir.endsWith("/") || cacheDir.endsWith("\\") ? "" : "/";
        const imagePath = `${cacheDir}${sep}pins/pin-${id}.png`;
        if (!cancelled) setImageUrl(convertFileSrc(imagePath));
      } catch {
        if (!cancelled) setImageUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;

    const handleWheel = async (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.max(0.5, Math.min(3.0, scale + delta));
      if (newScale === scale) return;
      setScale(newScale);
      try {
        await setPinScale(id, newScale);
      } catch {
        // ignore
      }
    };

    const handleDoubleClick = async () => {
      try {
        await closePin(id);
      } catch {
        // ignore
      }
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        try {
          await closePin(id);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, scale]);

  const handleMouseDown = async () => {
    try {
      await getCurrentWebviewWindow().startDragging();
    } catch {
      // ignore
    }
  };

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    cursor: "move",
    boxSizing: "border-box",
    padding: PIN_SHADOW_PADDING,
    background: "transparent",
  };

  const imgStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
    boxShadow: PIN_GLOW,
  };

  if (!id || !imageUrl) return null;

  return (
    <div style={containerStyle} onMouseDown={handleMouseDown}>
      <img src={imageUrl} alt="Pinned screenshot" style={imgStyle} draggable={false} />
    </div>
  );
}
