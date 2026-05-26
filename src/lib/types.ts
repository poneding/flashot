export type Point = { x: number; y: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowRect = {
  rect: Rect;
  title: string;
  appName: string;
  pid: number;
};

export type MonitorInfo = {
  id: number;
  rect: Rect;          // logical pixel rect on the global desktop
  scaleFactor: number; // physical/logical
};

export type CaptureStartPayload = {
  monitorId: number;
  frameUrl: string;          // tauri asset:// url
  monitorRect: Rect;
  scaleFactor: number;
  windows: WindowRect[];     // already translated to monitor-local coords
  cornerRadius: number;
};

export type QuickShotFlashPayload = {
  rect: Rect;
};

export type Mode =
  | "idle"
  | "hover"
  | "dragging"
  | "committed"
  | "locked"
  | "scrollStarting"
  | "scrolling";

export type ToolbarPosition =
  | { kind: "below"; x: number; y: number }
  | { kind: "above"; x: number; y: number }
  | { kind: "inside"; x: number; y: number }
  | { kind: "left"; x: number; y: number }
  | { kind: "right"; x: number; y: number };

export type Settings = {
  captureHotkey: string;      // e.g. "Cmd+Shift+A"
  fullscreenHotkey: string;   // e.g. "Cmd+Shift+F"
  activeWindowHotkey: string; // e.g. "Cmd+Shift+W"
  theme: "system" | "light" | "dark";
  accentColor: string;
  language: "system" | "en" | "zh-CN";
  launchAtLogin: boolean;
  lastSaveDir: string | null;
  cornerRadius: number;
};

export type PinInfo = {
  id: string;
  imagePath: string;
  windowLabel: string;
  originalWidth: number;
  originalHeight: number;
  currentScale: number;
};

export type ScrollProgress = {
  frames: number;
  height: number;
  previewDataUrl: string;
  lastScore: number;
};

export type ScrollEndReason = "bottom" | "max-height" | "user";

export type ScrollResult = {
  width: number;
  height: number;
  frameCount: number;
};
