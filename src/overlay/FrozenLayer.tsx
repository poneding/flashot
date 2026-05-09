import { useOverlay } from "@/overlay/state";

export function FrozenLayer() {
  const url = useOverlay((s) => s.frameUrl);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
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
