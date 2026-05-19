import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

const iconDir = path.resolve(__dirname, "../../src-tauri/icons");
const traySource = readFileSync(
  path.resolve(__dirname, "../../src-tauri/src/tray.rs"),
  "utf8",
);
const buildSource = readFileSync(
  path.resolve(__dirname, "../../src-tauri/build.rs"),
  "utf8",
);
const libSource = readFileSync(
  path.resolve(__dirname, "../../src-tauri/src/lib.rs"),
  "utf8",
);

describe("tray menu", () => {
  it("uses the configured capture hotkey for the capture accelerator", () => {
    expect(traySource).toMatch(/install\(\s*app: &AppHandle,\s*capture_hotkey: &str,\s*fullscreen_hotkey: &str,\s*active_window_hotkey: &str,\s*\)/);
    expect(traySource).toContain("capture_menu_accelerator(capture_hotkey)");
    expect(traySource).toContain("active_screen_menu_accelerator(fullscreen_hotkey)");
    expect(traySource).toContain("active_window_menu_accelerator(active_window_hotkey)");
    expect(traySource).toContain("pub fn update_menu(");
  });

  it("adds tray menu actions for active screen and active window quick shots", () => {
    expect(traySource).toContain('"quick-active-screen"');
    expect(traySource).toContain('"quick-active-window"');
    expect(traySource).toContain('"quick-shot:active-display"');
    expect(traySource).toContain('"quick-shot:active-window"');
  });

  it("labels and icons the three capture actions consistently", () => {
    expect(traySource).toContain('"Capture Region"');
    expect(traySource).toContain('"Capture Screen"');
    expect(traySource).toContain('"Capture Window"');
    expect(traySource).toContain("IconMenuItem::with_id");
    expect(traySource).toContain("MenuIcon::Crop");
    expect(traySource).toContain("MenuIcon::Monitor");
    expect(traySource).toContain("MenuIcon::AppWindow");
  });

  it("uses icons or reserved icon slots for every normal tray menu item", () => {
    expect(traySource).toContain("MenuIcon::Settings");
    expect(traySource).toContain("MenuIcon::Refresh");
    expect(traySource).toContain("MenuIcon::Info");
    expect(traySource).toContain("MenuIcon::CircleX");
    expect(traySource).not.toContain("MenuIcon::Power");
    expect(traySource).toContain("transparent_menu_icon()");
    expect(traySource).toContain("menu_item_icon(");
    expect(traySource).not.toMatch(/\bMenuItem::with_id\(/);
  });

  it("generates tray menu icons from Lucide SVG assets at build time", () => {
    expect(buildSource).toContain("LUCIDE_STROKE_WIDTH");
    expect(buildSource).toContain("MENU_ICON_OPACITY");
    expect(buildSource).toContain("stroke-linecap=\"round\"");
    expect(buildSource).not.toContain("stroke-opacity=");
    expect(buildSource).toContain('format!("{}-light.png", icon.name)');
    expect(buildSource).toContain("refresh-cw");
    expect(traySource).toContain('env!("OUT_DIR")');
    expect(traySource).toContain("/menu-icons/crop-light.png");
    expect(traySource).not.toContain("struct MenuIconCanvas");
  });

  it("refreshes tray menu icons when the system theme changes", () => {
    expect(libSource).toContain(".on_window_event");
    expect(libSource).toContain("WindowEvent::ThemeChanged");
    expect(libSource).toContain("tray::update_menu");
  });

  it("marks settings with a platform-aware accelerator", () => {
    expect(traySource).toContain("settings_menu_accelerator()");
    expect(traySource).not.toContain("CommandOrControl+,");
  });

  it("marks quit with a platform-aware accelerator that exits the app", () => {
    expect(traySource).toContain("quit_menu_accelerator()");
    expect(traySource).not.toContain("CommandOrControl+Q");
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
