import { convertFileSrc } from "@tauri-apps/api/core";
import { useOverlay } from "@/overlay/state";

const ASSET_LOCALHOST_PREFIX = "asset://localhost/";

function decodeAssetPath(path: string) {
  if (!path.includes("%")) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function frameSourceFromUrl(url: string) {
  if (!url.startsWith(ASSET_LOCALHOST_PREFIX)) return url;

  // Backend sessions currently emit asset://localhost/<absolute path>.
  // convertFileSrc encodes that path into a source WebView can load reliably.
  return convertFileSrc(decodeAssetPath(url.slice(ASSET_LOCALHOST_PREFIX.length)));
}

export function FrozenLayer() {
  const url = useOverlay((s) => s.frameUrl);
  if (!url) return null;
  return (
    <img
      src={frameSourceFromUrl(url)}
      alt=""
      data-frozen-layer
      draggable={false}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "fill",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}
