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
};

export type Mode = "idle" | "hover" | "dragging" | "committed" | "locked";

export type ToolbarPosition =
  | { kind: "below"; x: number; y: number }
  | { kind: "above"; x: number; y: number }
  | { kind: "inside"; x: number; y: number }
  | { kind: "left"; x: number; y: number }
  | { kind: "right"; x: number; y: number };

export type Settings = {
  hotkey: string;             // e.g. "CommandOrControl+Shift+X"
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  lastSaveDir: string | null;
};
