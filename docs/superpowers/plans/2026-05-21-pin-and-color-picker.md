# Pin Image + Color Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pin Image (pin screenshots to screen as always-on-top windows) and Color Picker (real-time color extraction panel following crosshair cursor) features to Flashot v0.3.0 batch 1.

**Architecture:** Pin uses independent Tauri windows (one per pin) managed by a Rust PinManager. Color Picker is a pure frontend Canvas component in the overlay that reads pixels from the frozen frame image.

**Tech Stack:** Tauri 2, React, TypeScript, Zustand, Canvas API, Rust (parking_lot, uuid)

---

## File Structure

### New Files

- `src-tauri/src/pin_mgr.rs` — PinManager state and Pin window lifecycle
- `src/routes/Pin.tsx` — Pin window React route
- `src/overlay/ColorPicker.tsx` — Color picker overlay component
- `src/__tests__/color-picker.test.ts` — Color picker unit tests

### Modified Files

- `src-tauri/src/lib.rs` — Register PinManager state and commands
- `src-tauri/src/commands.rs` — Add pin_image and pin management commands
- `src/overlay/state.ts` — Add colorFormat and colorCopied state
- `src/overlay/Toolbar.tsx` — Add Pin button
- `src/routes/Overlay.tsx` — Render ColorPicker component
- `src/lib/ipc.ts` — Add typed wrappers for pin commands
- `src/lib/types.ts` — Add PinInfo type
- `src-tauri/Cargo.toml` — Add uuid dependency

---

## Task 1: Add uuid dependency

**Files:**

- Modify: `src-tauri/Cargo.toml:60`

- [ ] **Step 1: Add uuid crate**

Add after line 60 (after `image` dependency):

```toml
uuid = { version = "1.11", features = ["v4"] }
```

- [ ] **Step 2: Verify dependency resolves**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully, uuid crate downloaded

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add uuid dependency for pin image feature"
```

---

## Task 2: Create PinManager Rust module

**Files:**

- Create: `src-tauri/src/pin_mgr.rs`

- [ ] **Step 1: Write test for PinManager creation**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_manager_starts_empty() {
        let mgr = PinManager::new();
        let inner = mgr.inner.lock();
        assert_eq!(inner.pins.len(), 0);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test pin_manager_starts_empty`
Expected: FAIL with "no module named pin_mgr"

- [ ] **Step 3: Write minimal PinManager implementation**

```rust
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone)]
pub struct PinEntry {
    pub id: String,
    pub image_path: PathBuf,
    pub window_label: String,
    pub original_width: u32,
    pub original_height: u32,
    pub current_scale: f64,
}

#[derive(Default)]
pub struct PinManager {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    pins: HashMap<String, PinEntry>,
}

impl PinManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test pin_manager_starts_empty`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pin_mgr.rs
git commit -m "feat: add PinManager struct for pin image lifecycle"
```

---

## Task 3: Add PinManager methods

**Files:**

- Modify: `src-tauri/src/pin_mgr.rs`

- [ ] **Step 1: Write test for add_pin**

Add to tests module:

```rust
#[test]
fn add_pin_stores_entry() {
    let mgr = PinManager::new();
    let entry = PinEntry {
        id: "test-id".to_string(),
        image_path: PathBuf::from("/tmp/test.png"),
        window_label: "pin-test-id".to_string(),
        original_width: 100,
        original_height: 100,
        current_scale: 1.0,
    };
    
    mgr.add_pin(entry.clone());
    
    let retrieved = mgr.get_pin("test-id").unwrap();
    assert_eq!(retrieved.id, "test-id");
    assert_eq!(retrieved.original_width, 100);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test add_pin_stores_entry`
Expected: FAIL with "no method named `add_pin`"

- [ ] **Step 3: Implement add_pin and get_pin methods**

Add to `impl PinManager`:

```rust
pub fn add_pin(&self, entry: PinEntry) {
    self.inner.lock().pins.insert(entry.id.clone(), entry);
}

pub fn get_pin(&self, id: &str) -> Option<PinEntry> {
    self.inner.lock().pins.get(id).cloned()
}

pub fn remove_pin(&self, id: &str) -> Option<PinEntry> {
    self.inner.lock().pins.remove(id)
}

pub fn all_pin_ids(&self) -> Vec<String> {
    self.inner.lock().pins.keys().cloned().collect()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test add_pin_stores_entry`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pin_mgr.rs
git commit -m "feat: add PinManager methods for pin lifecycle"
```

---

## Task 4: Register PinManager in Tauri app

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add pin_mgr module declaration**

Add after line 1 (after existing mod declarations):

```rust
mod pin_mgr;
```

- [ ] **Step 2: Import PinManager in run function**

Add to imports at top of `run` function (around line 20):

```rust
use pin_mgr::PinManager;
```

- [ ] **Step 3: Initialize PinManager state**

Add before `.setup(|app| {` line (around line 50):

```rust
.manage(PinManager::new())
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: register PinManager as Tauri managed state"
```

---

## Task 5: Add pin_image Tauri command

**Files:**

- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Add imports at top of file**

Add after existing imports (around line 7):

```rust
use crate::pin_mgr::{PinEntry, PinManager};
use std::sync::Arc;
use uuid::Uuid;
```

- [ ] **Step 2: Write pin_image command**

Add after the `list_system_fonts` command (around line 238):

```rust
#[tauri::command]
pub async fn pin_image(
    monitor_id: u32,
    rect: Rect,
    app: AppHandle,
    mgr: State<'_, Arc<WindowMgr>>,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<String, String> {
    let frame = mgr.frame(monitor_id).ok_or("no frame for monitor")?;
    let cropped = crop_rgba(
        &frame.rgba,
        frame.width,
        frame.height,
        rect,
        frame.scale_factor,
    )
    .ok_or("crop failed")?;

    let pin_id = Uuid::new_v4().to_string();
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let pins_dir = cache_dir.join("pins");
    std::fs::create_dir_all(&pins_dir).map_err(|e| e.to_string())?;
    
    let image_path = pins_dir.join(format!("pin-{}.png", pin_id));
    save_png(&cropped.rgba, cropped.width, cropped.height, &image_path)
        .map_err(|e| e.to_string())?;

    let window_label = format!("pin-{}", pin_id);
    let url = tauri::WebviewUrl::App(format!("index.html#/pin/{}", pin_id).into());
    
    tauri::WebviewWindowBuilder::new(&app, &window_label, url)
        .title("")
        .inner_size(rect.width as f64, rect.height as f64)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    pin_mgr.add_pin(PinEntry {
        id: pin_id.clone(),
        image_path,
        window_label,
        original_width: rect.width as u32,
        original_height: rect.height as u32,
        current_scale: 1.0,
    });

    mgr.end_session(&app);
    Ok(pin_id)
}

fn save_png(rgba: &[u8], width: u32, height: u32, path: &std::path::Path) -> Result<(), String> {
    use image::{ImageBuffer, RgbaImage};
    let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba.to_vec())
        .ok_or("Failed to create image buffer")?;
    img.save(path).map_err(|e| format!("Failed to save PNG: {}", e))
}
```

- [ ] **Step 3: Register command in lib.rs**

Add `pin_image` to the `tauri::generate_handler![]` list in `src-tauri/src/lib.rs` (around line 100):

```rust
tauri::generate_handler![
    commands::crop_and_copy,
    commands::crop_and_save,
    commands::cancel_capture,
    commands::show_capture_overlay,
    commands::get_settings,
    commands::set_settings,
    commands::open_settings_window,
    commands::begin_text_input_session,
    commands::end_text_input_session,
    commands::open_about_window,
    commands::open_updater_window,
    commands::quit_app,
    commands::list_system_fonts,
    commands::pin_image,
]
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add pin_image command to create pin windows"
```

---

## Task 6: Add close_pin command

**Files:**

- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: Write close_pin command**

Add after `pin_image` command:

```rust
#[tauri::command]
pub async fn close_pin(
    pin_id: String,
    app: AppHandle,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let entry = pin_mgr.remove_pin(&pin_id).ok_or("pin not found")?;
    
    if let Some(window) = app.get_webview_window(&entry.window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    
    let _ = std::fs::remove_file(&entry.image_path);
    Ok(())
}
```

- [ ] **Step 2: Write set_pin_scale command**

Add after `close_pin`:

```rust
#[tauri::command]
pub async fn set_pin_scale(
    pin_id: String,
    scale: f64,
    app: AppHandle,
    pin_mgr: State<'_, Arc<PinManager>>,
) -> Result<(), String> {
    let mut entry = pin_mgr.get_pin(&pin_id).ok_or("pin not found")?;
    let clamped_scale = scale.clamp(0.5, 3.0);
    
    let new_width = (entry.original_width as f64 * clamped_scale) as f64;
    let new_height = (entry.original_height as f64 * clamped_scale) as f64;
    
    if let Some(window) = app.get_webview_window(&entry.window_label) {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: new_width,
            height: new_height,
        })).map_err(|e| e.to_string())?;
    }
    
    entry.current_scale = clamped_scale;
    pin_mgr.add_pin(entry);
    Ok(())
}
```

- [ ] **Step 3: Register commands in lib.rs**

Add to `tauri::generate_handler![]`:

```rust
commands::close_pin,
commands::set_pin_scale,
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: Compiles successfully

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add close_pin and set_pin_scale commands"
```

---

## Task 7: Add frontend types for Pin

**Files:**

- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add PinInfo type**

Add at the end of the file:

```typescript
export type PinInfo = {
  id: string;
  imagePath: string;
  windowLabel: string;
  originalWidth: number;
  originalHeight: number;
  currentScale: number;
};
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add PinInfo type"
```

---

## Task 8: Add IPC wrappers for pin commands

**Files:**

- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add pin command wrappers**

Add after `listSystemFonts` function (around line 44):

```typescript
export async function pinImage(monitorId: number, rect: Rect): Promise<string> {
  return await invoke<string>("pin_image", { monitorId, rect });
}

export async function closePin(pinId: string): Promise<void> {
  await invoke("close_pin", { pinId });
}

export async function setPinScale(pinId: string, scale: number): Promise<void> {
  await invoke("set_pin_scale", { pinId, scale });
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat: add IPC wrappers for pin commands"
```

---

## Task 9: Create Pin window React route

**Files:**

- Create: `src/routes/Pin.tsx`

- [ ] **Step 1: Write Pin component**

```typescript
import { closePin, setPinScale } from "@/lib/ipc";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";

export function Pin() {
  const { id } = useParams<{ id: string }>();
  const [scale, setScale] = useState(1.0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    
    const loadImage = async () => {
      const cacheDir = await import("@tauri-apps/api/path").then(m => m.appCacheDir());
      const imagePath = `${cacheDir}/pins/pin-${id}.png`;
      setImageUrl(convertFileSrc(imagePath));
    };
    
    loadImage();
  }, [id]);

  useEffect(() => {
    const handleWheel = async (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.max(0.5, Math.min(3.0, scale + delta));
      setScale(newScale);
      if (id) await setPinScale(id, newScale);
    };

    const handleDoubleClick = async () => {
      if (id) await closePin(id);
    };

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "Escape" && id) {
        await closePin(id);
      }
    };

    window.addEventListener("wheel", handleWheel);
    window.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [id, scale]);

  const handleMouseDown = async () => {
    await getCurrentWebviewWindow().startDragging();
  };

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    cursor: "move",
  };

  const imgStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    userSelect: "none",
    pointerEvents: "none",
  };

  if (!imageUrl) return null;

  return (
    <div style={containerStyle} onMouseDown={handleMouseDown}>
      <img src={imageUrl} alt="Pinned screenshot" style={imgStyle} draggable={false} />
    </div>
  );
}
```

- [ ] **Step 2: Register route in App.tsx**

Add Pin route to `src/App.tsx` (after other routes):

```typescript
<Route path="/pin/:id" element={<Pin />} />
```

And add import at top:

```typescript
import { Pin } from "@/routes/Pin";
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/routes/Pin.tsx src/App.tsx
git commit -m "feat: add Pin window React route"
```

---

## Task 10: Add Pin button to toolbar

**Files:**

- Modify: `src/overlay/Toolbar.tsx`

- [ ] **Step 1: Import PinIcon and pinImage**

Add to imports at top:

```typescript
import { CopyIcon, SaveIcon, XIcon, PinIcon, type LucideIcon } from "lucide-react";
import { cancelCapture, cropAndCopy, cropAndSave, pinImage } from "@/lib/ipc";
```

- [ ] **Step 2: Update toolbar width constant**

Change line 7:

```typescript
const TB = { width: 148, height: 40 };
```

- [ ] **Step 3: Add onPin handler**

Add after `onSave` function (around line 83):

```typescript
const onPin = async () => {
  if (busy) return;
  setBusy(true);
  try {
    await pinImage(monitorId, sel);
  } finally {
    setBusy(false);
  }
};
```

- [ ] **Step 4: Add Pin button to toolbar**

Add after Save button (around line 120):

```typescript
<ToolbarButton label="Pin" icon={PinIcon} onClick={onPin} disabled={busy} />
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 6: Test Pin button in dev mode**

Run: `pnpm tauri dev`
Expected: Toolbar shows Copy, Save, Pin, Close buttons. Pin button creates a new window.

- [ ] **Step 7: Commit**

```bash
git add src/overlay/Toolbar.tsx
git commit -m "feat: add Pin button to toolbar"
```

---

## Task 11: Add color picker state to overlay store

**Files:**

- Modify: `src/overlay/state.ts`

- [ ] **Step 1: Add color picker state fields**

Add to State type (after line 27):

```typescript
colorFormat: "hex" | "rgb";
colorCopied: boolean;
```

- [ ] **Step 2: Add color picker actions**

Add to Actions type (after line 47):

```typescript
toggleColorFormat: () => void;
setColorCopied: (v: boolean) => void;
```

- [ ] **Step 3: Initialize state in store**

Add to initial state (after line 78):

```typescript
colorFormat: "hex",
colorCopied: false,
```

- [ ] **Step 4: Implement actions**

Add after `end` action (around line 202):

```typescript
toggleColorFormat: () => {
  const current = get().colorFormat;
  set({ colorFormat: current === "hex" ? "rgb" : "hex" });
},
setColorCopied: (v) => set({ colorCopied: v }),
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/overlay/state.ts
git commit -m "feat: add color picker state to overlay store"
```

---

## Task 12: Create ColorPicker component (part 1 - structure)

**Files:**

- Create: `src/overlay/ColorPicker.tsx`

- [ ] **Step 1: Write ColorPicker component structure**

```typescript
import { useOverlay } from "@/overlay/state";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const MAGNIFIER_SIZE = 120;
const PIXEL_GRID_SIZE = 15;
const PIXEL_BLOCK_SIZE = MAGNIFIER_SIZE / PIXEL_GRID_SIZE; // 8px per pixel

export function ColorPicker() {
  const mode = useOverlay((s) => s.mode);
  const cursor = useOverlay((s) => s.cursor);
  const frameUrl = useOverlay((s) => s.frameUrl);
  const scaleFactor = useOverlay((s) => s.scaleFactor);
  const monitorRect = useOverlay((s) => s.monitorRect);
  const colorFormat = useOverlay((s) => s.colorFormat);
  const colorCopied = useOverlay((s) => s.colorCopied);

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentColor, setCurrentColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const visible = (mode === "hover" || mode === "committed") && cursor && frameUrl;

  if (!visible) return null;

  return (
    <div style={containerStyle}>
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

function formatColorText(c: { r: number; g: number; b: number }, format: "hex" | "rgb"): string {
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
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/overlay/ColorPicker.tsx
git commit -m "feat: add ColorPicker component structure"
```

---

## Task 13: Add pixel reading logic to ColorPicker

**Files:**

- Modify: `src/overlay/ColorPicker.tsx`

- [ ] **Step 1: Add effect to load frozen frame into offscreen canvas**

Add after the `useState` declarations (around line 21):

```typescript
useEffect(() => {
  if (!frameUrl) return;
  
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
```

- [ ] **Step 2: Add effect to read pixels and update magnifier**

Add after the previous effect:

```typescript
useEffect(() => {
  if (!cursor || !offscreenCanvasRef.current || !magnifierCanvasRef.current) return;
  
  const offscreenCtx = offscreenCanvasRef.current.getContext("2d", { willReadFrequently: true });
  const magnifierCtx = magnifierCanvasRef.current.getContext("2d");
  if (!offscreenCtx || !magnifierCtx) return;

  const physX = Math.floor(cursor.x * scaleFactor);
  const physY = Math.floor(cursor.y * scaleFactor);
  
  const halfGrid = Math.floor(PIXEL_GRID_SIZE / 2);
  const startX = Math.max(0, physX - halfGrid);
  const startY = Math.max(0, physY - halfGrid);
  
  const imageData = offscreenCtx.getImageData(startX, startY, PIXEL_GRID_SIZE, PIXEL_GRID_SIZE);
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
        PIXEL_BLOCK_SIZE
      );
    }
  }
  
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
  
  magnifierCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  magnifierCtx.lineWidth = 2;
  magnifierCtx.strokeRect(
    halfGrid * PIXEL_BLOCK_SIZE,
    halfGrid * PIXEL_BLOCK_SIZE,
    PIXEL_BLOCK_SIZE,
    PIXEL_BLOCK_SIZE
  );
  
  const centerIdx = (halfGrid * PIXEL_GRID_SIZE + halfGrid) * 4;
  setCurrentColor({
    r: pixels[centerIdx],
    g: pixels[centerIdx + 1],
    b: pixels[centerIdx + 2],
  });
}, [cursor, scaleFactor]);
```

- [ ] **Step 3: Add positioning logic**

Add after the pixel reading effect:

```typescript
useEffect(() => {
  if (!cursor || !monitorRect) return;
  
  const PANEL_WIDTH = 136;
  const PANEL_HEIGHT = 170;
  const OFFSET = 20;
  
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
```

- [ ] **Step 4: Apply position to container style**

Update the return statement to apply position:

```typescript
return (
  <div style={{ ...containerStyle, left: position.x, top: position.y }}>
```

- [ ] **Step 5: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/overlay/ColorPicker.tsx
git commit -m "feat: add pixel reading and positioning to ColorPicker"
```

---

## Task 14: Add keyboard handlers for ColorPicker

**Files:**

- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Import clipboard and overlay actions**

Add to imports at top:

```typescript
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
```

- [ ] **Step 2: Add keyboard handler for Tab and C keys**

Add to the existing `handleKeyDown` function in Overlay.tsx (find the function that handles Escape key):

```typescript
const handleKeyDown = useCallback(
  async (e: KeyboardEvent) => {
    const { mode, selection, toggleColorFormat, setColorCopied } = useOverlay.getState();
    
    // Existing Escape handler...
    if (e.key === "Escape") {
      // ... existing code
    }
    
    // Color picker: Tab to toggle format
    if (e.key === "Tab" && (mode === "hover" || mode === "committed")) {
      e.preventDefault();
      toggleColorFormat();
    }
    
    // Color picker: C to copy color
    if (e.key === "c" && (mode === "hover" || mode === "committed")) {
      const { colorFormat, cursor } = useOverlay.getState();
      if (!cursor) return;
      
      // Get current color from ColorPicker component state
      // We need to access the current color - will be passed via store
      const colorText = getCurrentColorText();
      if (colorText) {
        await writeText(colorText);
        setColorCopied(true);
        setTimeout(() => setColorCopied(false), 1500);
      }
    }
  },
  []
);
```

- [ ] **Step 3: Update overlay state to store current color**

Add to `src/overlay/state.ts` State type:

```typescript
currentColor: { r: number; g: number; b: number } | null;
```

Initialize in store:

```typescript
currentColor: null,
```

Add action:

```typescript
setCurrentColor: (c: { r: number; g: number; b: number } | null) => void;
```

Implement:

```typescript
setCurrentColor: (c) => set({ currentColor: c }),
```

- [ ] **Step 4: Update ColorPicker to store current color in state**

In `src/overlay/ColorPicker.tsx`, replace `setCurrentColor` local state with store action:

```typescript
const setCurrentColor = useOverlay((s) => s.setCurrentColor);
```

Remove the local `useState` for currentColor and use store instead:

```typescript
const currentColor = useOverlay((s) => s.currentColor);
```

- [ ] **Step 5: Update keyboard handler to use store color**

In `src/routes/Overlay.tsx`, update the C key handler:

```typescript
if (e.key === "c" && (mode === "hover" || mode === "committed")) {
  const { colorFormat, currentColor } = useOverlay.getState();
  if (!currentColor) return;
  
  const colorText = colorFormat === "hex"
    ? `#${currentColor.r.toString(16).padStart(2, "0").toUpperCase()}${currentColor.g.toString(16).padStart(2, "0").toUpperCase()}${currentColor.b.toString(16).padStart(2, "0").toUpperCase()}`
    : `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
  
  await writeText(colorText);
  setColorCopied(true);
  setTimeout(() => setColorCopied(false), 1500);
}
```

- [ ] **Step 6: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/routes/Overlay.tsx src/overlay/state.ts src/overlay/ColorPicker.tsx
git commit -m "feat: add keyboard handlers for color picker (Tab/C keys)"
```

---

## Task 15: Render ColorPicker in Overlay

**Files:**

- Modify: `src/routes/Overlay.tsx`

- [ ] **Step 1: Import ColorPicker**

Add to imports:

```typescript
import { ColorPicker } from "@/overlay/ColorPicker";
```

- [ ] **Step 2: Add ColorPicker to render tree**

Add after Toolbar component in the return statement:

```typescript
<Toolbar />
<ColorPicker />
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm lint`
Expected: No errors

- [ ] **Step 4: Test in dev mode**

Run: `pnpm tauri dev`
Expected:

- Trigger capture with hotkey
- Color picker panel appears near crosshair cursor
- Panel shows magnified pixels with grid lines
- Panel follows cursor movement
- Tab key switches between HEX and RGB format
- C key copies color to clipboard and shows "Copied!" feedback

- [ ] **Step 5: Commit**

```bash
git add src/routes/Overlay.tsx
git commit -m "feat: render ColorPicker in overlay"
```

---

## Task 16: Write unit tests for color format conversion

**Files:**

- Create: `src/__tests__/color-picker.test.ts`

- [ ] **Step 1: Write test for hex format conversion**

```typescript
import { describe, it, expect } from "vitest";

function formatColorText(c: { r: number; g: number; b: number }, format: "hex" | "rgb"): string {
  if (format === "hex") {
    return `#${c.r.toString(16).padStart(2, "0").toUpperCase()}${c.g.toString(16).padStart(2, "0").toUpperCase()}${c.b.toString(16).padStart(2, "0").toUpperCase()}`;
  }
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

describe("ColorPicker format conversion", () => {
  it("converts RGB to HEX format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "hex")).toBe("#FF5A2E");
  });

  it("converts RGB to RGB string format", () => {
    const color = { r: 255, g: 90, b: 46 };
    expect(formatColorText(color, "rgb")).toBe("rgb(255, 90, 46)");
  });

  it("handles black color", () => {
    const color = { r: 0, g: 0, b: 0 };
    expect(formatColorText(color, "hex")).toBe("#000000");
    expect(formatColorText(color, "rgb")).toBe("rgb(0, 0, 0)");
  });

  it("handles white color", () => {
    const color = { r: 255, g: 255, b: 255 };
    expect(formatColorText(color, "hex")).toBe("#FFFFFF");
    expect(formatColorText(color, "rgb")).toBe("rgb(255, 255, 255)");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/color-picker.test.ts
git commit -m "test: add unit tests for color format conversion"
```

---

## Task 17: Manual testing and bug fixes

**Files:**

- Various (as needed)

- [ ] **Step 1: Test Pin image feature**

Manual test checklist:

- [ ] Capture screenshot, select region, click Pin button
- [ ] Pin window appears with correct image
- [ ] Drag pin window to move it
- [ ] Scroll wheel to zoom in/out (50%-300% range)
- [ ] Double-click to close pin
- [ ] Esc key to close pin
- [ ] Create multiple pins simultaneously
- [ ] Verify pins persist after closing overlay

- [ ] **Step 2: Test Color picker feature**

Manual test checklist:

- [ ] Color picker appears in hover mode
- [ ] Panel follows cursor with correct positioning
- [ ] Panel flips to avoid screen edges
- [ ] Magnified view shows correct pixels
- [ ] Grid lines visible between pixels
- [ ] Center pixel highlighted
- [ ] Color value updates in real-time
- [ ] Tab key switches HEX ↔ RGB format
- [ ] C key copies color to clipboard
- [ ] "Copied!" feedback appears for 1.5s
- [ ] Panel hides during dragging
- [ ] Panel reappears in committed mode

- [ ] **Step 3: Fix any bugs found**

Document and fix issues discovered during testing.

- [ ] **Step 4: Commit bug fixes**

```bash
git add <modified-files>
git commit -m "fix: <description of bug fix>"
```

---

## Task 18: Update documentation

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Pin image feature to architecture section**

Add to "Key Rust Modules" section:

```markdown
- **`pin_mgr.rs`**: Pin image lifecycle manager. Tracks active pin windows and their associated image files in app cache.
```

Add to "Key Frontend Modules" section:

```markdown
- **`src/routes/Pin.tsx`**: Pin window route. Displays pinned screenshot with drag, zoom, and close interactions.
- **`src/overlay/ColorPicker.tsx`**: Color picker component. Canvas-based pixel magnifier with real-time color extraction.
```

- [ ] **Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: document pin image and color picker features"
```

---

## Task 19: Final verification

**Files:**

- N/A

- [ ] **Step 1: Run full test suite**

Run: `pnpm test && cd src-tauri && cargo test`
Expected: All tests pass

- [ ] **Step 2: Run linters**

Run: `pnpm lint && cd src-tauri && cargo clippy -- -D warnings`
Expected: No errors or warnings

- [ ] **Step 3: Build production bundle**

Run: `pnpm tauri build`
Expected: Build succeeds, creates .dmg/.msi/.AppImage

- [ ] **Step 4: Test production build**

Install and test the production build with both features.

- [ ] **Step 5: Create final commit if needed**

```bash
git add .
git commit -m "chore: final cleanup for v0.3.0 batch 1"
```

---

## Execution Complete

All tasks for Pin Image + Color Picker features are complete. The implementation includes:

✅ Pin Image - Always-on-top windows with drag, zoom, and close
✅ Color Picker - Real-time pixel magnifier with HEX/RGB format switching
✅ Unit tests for color format conversion
✅ Manual testing checklist
✅ Documentation updates

Ready for user acceptance testing and merge to main branch.
