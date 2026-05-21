import { useOverlay } from "@/overlay/state";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const MAGNIFIER_SIZE = 120;
const PIXEL_GRID_SIZE = 15;
const PIXEL_BLOCK_SIZE = MAGNIFIER_SIZE / PIXEL_GRID_SIZE; // 8px per pixel

const PANEL_WIDTH = 136;
const PANEL_HEIGHT = 170;
const OFFSET = 20;

export function ColorPicker() {
  const mode = useOverlay((s) => s.mode);
  const cursor = useOverlay((s) => s.cursor);
  const frameUrl = useOverlay((s) => s.frameUrl);
  const scaleFactor = useOverlay((s) => s.scaleFactor);
  const monitorRect = useOverlay((s) => s.monitorRect);
  const colorFormat = useOverlay((s) => s.colorFormat);
  const colorCopied = useOverlay((s) => s.colorCopied);
  const currentColor = useOverlay((s) => s.currentColor);
  const setCurrentColor = useOverlay((s) => s.setCurrentColor);

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Load frozen frame into offscreen canvas
  useEffect(() => {
    if (!frameUrl) {
      offscreenCanvasRef.current = null;
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        offscreenCanvasRef.current = canvas;
      }
    };
    img.src = frameUrl;
  }, [frameUrl]);

  // Read pixels and update magnifier on cursor move
  useEffect(() => {
    if (!cursor || !offscreenCanvasRef.current || !magnifierCanvasRef.current) return;

    const offscreenCtx = offscreenCanvasRef.current.getContext("2d", { willReadFrequently: true });
    const magnifierCtx = magnifierCanvasRef.current.getContext("2d");
    if (!offscreenCtx || !magnifierCtx) return;

    const physX = Math.floor(cursor.x * scaleFactor);
    const physY = Math.floor(cursor.y * scaleFactor);
    const halfGrid = Math.floor(PIXEL_GRID_SIZE / 2);

    // Clamp start to valid range
    const maxX = offscreenCanvasRef.current.width - PIXEL_GRID_SIZE;
    const maxY = offscreenCanvasRef.current.height - PIXEL_GRID_SIZE;
    const startX = Math.max(0, Math.min(physX - halfGrid, maxX));
    const startY = Math.max(0, Math.min(physY - halfGrid, maxY));

    let imageData: ImageData;
    try {
      imageData = offscreenCtx.getImageData(startX, startY, PIXEL_GRID_SIZE, PIXEL_GRID_SIZE);
    } catch (e) {
      return;
    }
    const pixels = imageData.data;

    magnifierCtx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

    for (let row = 0; row < PIXEL_GRID_SIZE; row++) {
      for (let col = 0; col < PIXEL_GRID_SIZE; col++) {
        const idx = (row * PIXEL_GRID_SIZE + col) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        magnifierCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        magnifierCtx.fillRect(
          col * PIXEL_BLOCK_SIZE,
          row * PIXEL_BLOCK_SIZE,
          PIXEL_BLOCK_SIZE,
          PIXEL_BLOCK_SIZE,
        );
      }
    }

    // Draw grid lines
    magnifierCtx.strokeStyle = "rgba(128, 128, 128, 0.3)";
    magnifierCtx.lineWidth = 1;
    for (let i = 1; i < PIXEL_GRID_SIZE; i++) {
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(i * PIXEL_BLOCK_SIZE, 0);
      magnifierCtx.lineTo(i * PIXEL_BLOCK_SIZE, MAGNIFIER_SIZE);
      magnifierCtx.stroke();

      magnifierCtx.beginPath();
      magnifierCtx.moveTo(0, i * PIXEL_BLOCK_SIZE);
      magnifierCtx.lineTo(MAGNIFIER_SIZE, i * PIXEL_BLOCK_SIZE);
      magnifierCtx.stroke();
    }

    // Highlight center pixel
    magnifierCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    magnifierCtx.lineWidth = 2;
    magnifierCtx.strokeRect(
      halfGrid * PIXEL_BLOCK_SIZE,
      halfGrid * PIXEL_BLOCK_SIZE,
      PIXEL_BLOCK_SIZE,
      PIXEL_BLOCK_SIZE,
    );

    // Update center color in store
    const centerIdx = (halfGrid * PIXEL_GRID_SIZE + halfGrid) * 4;
    setCurrentColor({
      r: pixels[centerIdx],
      g: pixels[centerIdx + 1],
      b: pixels[centerIdx + 2],
    });
  }, [cursor, scaleFactor, setCurrentColor]);

  // Position with edge flip
  useEffect(() => {
    if (!cursor || !monitorRect) return;

    let x = cursor.x + OFFSET;
    let y = cursor.y - PANEL_HEIGHT - OFFSET;

    if (x + PANEL_WIDTH > monitorRect.width) {
      x = cursor.x - PANEL_WIDTH - OFFSET;
    }

    if (y < 0) {
      y = cursor.y + OFFSET;
    }

    setPosition({ x, y });
  }, [cursor, monitorRect]);

  const visible = (mode === "hover" || mode === "committed") && cursor && frameUrl;
  if (!visible) return null;

  return (
    <div style={{ ...containerStyle, left: position.x, top: position.y }}>
      <canvas
        ref={magnifierCanvasRef}
        width={MAGNIFIER_SIZE}
        height={MAGNIFIER_SIZE}
        style={canvasStyle}
      />
      <div style={colorInfoStyle}>
        {colorCopied ? (
          <span style={copiedStyle}>Copied!</span>
        ) : currentColor ? (
          <>
            <div style={{ ...swatchStyle, backgroundColor: formatColorCss(currentColor) }} />
            <span>{formatColorText(currentColor, colorFormat)}</span>
          </>
        ) : null}
      </div>
      <div style={hintStyle}>Tab: switch format</div>
    </div>
  );
}

function formatColorCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function formatColorText(c: { r: number; g: number; b: number }, format: "hex" | "rgb"): string {
  if (format === "hex") {
    return `#${c.r.toString(16).padStart(2, "0").toUpperCase()}${c.g.toString(16).padStart(2, "0").toUpperCase()}${c.b.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

const containerStyle: CSSProperties = {
  position: "absolute",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 8,
  borderRadius: 8,
  background: "rgba(28,28,30,0.92)",
  backdropFilter: "blur(18px) saturate(160%)",
  WebkitBackdropFilter: "blur(18px) saturate(160%)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  color: "#f0f0f5",
  fontSize: 12,
  pointerEvents: "none",
};

const canvasStyle: CSSProperties = {
  display: "block",
  borderRadius: 4,
};

const colorInfoStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontFamily: "monospace",
};

const swatchStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 3,
  border: "1px solid rgba(255,255,255,0.2)",
};

const copiedStyle: CSSProperties = {
  color: "#4ade80",
  fontWeight: 500,
};

const hintStyle: CSSProperties = {
  fontSize: 10,
  color: "rgba(255,255,255,0.5)",
};
