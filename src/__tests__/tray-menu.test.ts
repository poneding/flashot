import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

const iconDir = path.resolve(__dirname, "../../src-tauri/icons");
const traySource = readFileSync(
  path.resolve(__dirname, "../../src-tauri/src/tray.rs"),
  "utf8",
);

describe("tray menu", () => {
  it("uses the configured capture hotkey for the capture accelerator", () => {
    expect(traySource).toMatch(/install\(app: &AppHandle, capture_hotkey: &str\)/);
    expect(traySource).toContain("capture_menu_accelerator(capture_hotkey)");
    expect(traySource).toContain("pub fn update_menu(app: &AppHandle, capture_hotkey: &str)");
  });

  it("marks settings with a platform-aware accelerator", () => {
    expect(traySource).toContain("CommandOrControl+,");
  });

  it("marks quit with a platform-aware accelerator that exits the app", () => {
    expect(traySource).toContain("CommandOrControl+Q");
    expect(traySource).toContain('"quit" => app.exit(0)');
  });

  it("uses a colored tray icon on Windows and Linux while keeping macOS templated", () => {
    const coloredIcon = readFileSync(path.join(iconDir, "menubar-colored-logo.png"));
    const pngSignature = coloredIcon.subarray(0, 8).toString("hex");
    const width = coloredIcon.readUInt32BE(16);
    const height = coloredIcon.readUInt32BE(20);
    const colorType = coloredIcon.readUInt8(25);

    expect(pngSignature).toBe("89504e470d0a1a0a");
    expect({ width, height, colorType }).toEqual({ width: 32, height: 32, colorType: 6 });
    expect(countVisibleColorPixels(coloredIcon, width, height)).toBeGreaterThan(100);
    expect(traySource).toMatch(/include_bytes!\(\s*"\.\.\/icons\/menubar-colored-logo\.png"\s*\)/);
    expect(traySource).toContain('#[cfg(target_os = "macos")]');
    expect(traySource).toContain('#[cfg(not(target_os = "macos"))]');
    expect(traySource).toContain(".icon_as_template(tray_icon_is_template())");
  });
});

function countVisibleColorPixels(png: Buffer, width: number, height: number): number {
  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }

  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let colored = 0;
  let src = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src];
    src += 1;
    inflated.copy(current, 0, src, src + stride);
    src += stride;
    unfilterScanline(current, previous, filter);

    for (let x = 0; x < stride; x += 4) {
      const alpha = current[x + 3];
      if (alpha > 0 && (current[x] !== current[x + 1] || current[x + 1] !== current[x + 2])) {
        colored += 1;
      }
    }

    current.copy(previous);
  }

  return colored;
}

function unfilterScanline(current: Buffer, previous: Buffer, filter: number) {
  const bytesPerPixel = 4;
  for (let i = 0; i < current.length; i += 1) {
    const left = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
    const up = previous[i];
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    if (filter === 1) current[i] = (current[i] + left) & 0xff;
    else if (filter === 2) current[i] = (current[i] + up) & 0xff;
    else if (filter === 3) current[i] = (current[i] + Math.floor((left + up) / 2)) & 0xff;
    else if (filter === 4) current[i] = (current[i] + paeth(left, up, upLeft)) & 0xff;
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
