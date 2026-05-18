# Flashot v0.2.0 — Annotation Feature Design

## Overview

Add basic annotation capabilities to Flashot. After capturing a selection, users can draw annotations (pen, lines, rectangles, ellipses, text, blur, highlight) on the selection, then copy or save the final image with annotations.

## Technology Choices

### Rendering Layer

- **Konva** (imperative API, without react-konva) — Canvas 2D rendering engine providing object model, Transformer, and built-in filters
- **perfect-freehand** — Generates pressure-sensitive stroke outlines for pen and highlight freehand drawing

Rationale:
- Bypasses React reconciler during drawing, achieving near-native Canvas performance
- Built-in Blur/Pixelate filters eliminate need to implement mosaic/blur from scratch
- Transformer handles object selection/scaling, reducing custom code significantly
- ~56 KB gzip, acceptable for a desktop application

### Output Compositing

Hybrid approach: frontend exports annotation layer as transparent PNG → Rust alpha-composites with original screenshot.

Rationale:
- Avoids re-encoding the full background image in the browser (toBlob takes ~200-400ms at 4K)
- Annotation layer is mostly transparent, compresses efficiently as PNG, export ~50-100ms
- Rust-side alpha-composite takes only ~5ms
- Original frame is already held in Rust's WindowMgr, no need to transfer back over IPC

### New Dependencies

```json
{
  "konva": "^10.3.0",
  "perfect-freehand": "^1.2.2"
}
```

Handwriting font: Excalifont woff2 bundled to `public/fonts/`

## State Machine Extension

Current overlay states: `idle → hover → dragging → committed → locked`

Annotation activates within the `committed` state. New annotation sub-state:

```
committed
  └── annotation
        ├── activeTool: 'select' | 'draw' | 'line' | 'rect' | 'ellipse' | 'text' | 'blur' | 'highlight' | 'eraser'
        ├── drawingState: 'idle' | 'active'
        └── selectedObjectId: string | null
```

Entry: After selection is committed, the toolbar displays all annotation tools immediately. Default active tool is "select" (to prevent accidental drawing).

Exit: Esc exits the entire capture session (consistent with existing behavior). Annotations are not persisted.

## Layer Architecture

```
┌─────────────────────────────────────────┐
│  Toolbar + Property Panel (React DOM)    │  Toolbar + popup property panel
├─────────────────────────────────────────┤
│  Text Input Overlay (HTML textarea)      │  Temporary overlay during text editing
├─────────────────────────────────────────┤
│  Konva Stage (Canvas)                    │  Annotation rendering layer
├─────────────────────────────────────────┤
│  Selection Box + Handles (React DOM)     │  Selection border / resize handles
├─────────────────────────────────────────┤
│  Frozen Screenshot (img)                 │  Background image
├─────────────────────────────────────────┤
│  Dim Mask (React DOM)                    │  Dimming outside selection
└─────────────────────────────────────────┘
```

Konva Stage overlays the selection interior. Size = selection dimensions, position = selection top-left. Stage follows selection on resize.

## Tool Definitions

### Tool List

| Tool | Icon | Properties |
|------|------|------------|
| Select | Pointer/cursor | None |
| Pen | Pencil | Color, stroke width |
| Line | Diagonal line | Color, stroke width, shape, style, arrow direction, arrow style |
| Rectangle | Square | Color, stroke width, fill, corner radius |
| Ellipse | Oval | Color, stroke width, fill |
| Text | T | Color, font family, font size |
| Blur | Droplet/blur | Mode, draw method, intensity |
| Highlight | Highlighter | Color, stroke width, line mode |
| Eraser | Eraser | Stroke width |

### Line Tool Property Dimensions

Four independently configurable dimensions, freely combinable:

- **Shape**: Straight | Wavy (sine wave, fixed amplitude and frequency, adapts to line length)
- **Style**: Solid | Dotted | Dashed
- **Arrow direction**: None | Start | End | Both
- **Arrow style**: V-shape | Filled triangle

### Property Details

**Color**: 8-12 preset colors + custom color picker button

**Stroke width**: 3-5 fixed presets, click to switch (e.g., 2px / 4px / 6px / 8px / 12px)

**Fill** (rectangle/ellipse): Hollow | Solid

**Corner radius** (rectangle): None | Rounded (fixed radius)

**Font**: Handwriting (Excalifont) | System standard font list

**Font size**: Preset levels (14 / 18 / 24 / 32 / 48)

**Blur mode**: Mosaic | Gaussian blur

**Blur draw method**: Rectangle selection | Freehand smear

**Blur intensity**: 3 levels (Light / Medium / Heavy)

**Highlight line mode**: Freehand | Straight line

## Data Model

### Annotation Object

```typescript
type AnnotationId = string

type AnnotationObject = {
  id: AnnotationId
  type: 'draw' | 'line' | 'rect' | 'ellipse' | 'text' | 'blur' | 'highlight'
  // Freehand types (draw, highlight-freehand, blur-freehand)
  points?: number[]
  // Geometric types (line, rect, ellipse, blur-rect, highlight-straight)
  start?: Point
  end?: Point
  // Text
  text?: string
  // Style
  style: AnnotationStyle
  // Transform (after selection: move/scale)
  transform: {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
  }
}

type AnnotationStyle = {
  color: string
  strokeWidth: number
  // Line
  lineShape?: 'straight' | 'wavy'
  lineStyle?: 'solid' | 'dotted' | 'dashed'
  arrow?: 'none' | 'start' | 'end' | 'both'
  arrowStyle?: 'v-shape' | 'filled-triangle'
  // Shape
  fill?: 'hollow' | 'solid'
  cornerRadius?: number
  // Text
  fontFamily?: string
  fontSize?: number
  // Blur
  blurMode?: 'mosaic' | 'gaussian'
  blurMethod?: 'rect' | 'freehand'
  blurIntensity?: number
  // Highlight
  highlightMode?: 'freehand' | 'straight'
  opacity?: number
}
```

### Undo/Redo Command Stack

```typescript
type Command = {
  type: 'add' | 'delete' | 'move' | 'resize' | 'modify-style'
  objectId: AnnotationId
  before: Partial<AnnotationObject>
  after: Partial<AnnotationObject>
}

// Maintained in Zustand store
type AnnotationState = {
  objects: AnnotationObject[]
  commandStack: Command[]
  commandIndex: number  // Current position, supports redo
  activeTool: ToolType
  activeStyle: AnnotationStyle  // Current tool's style settings
  selectedObjectId: AnnotationId | null
  drawingState: 'idle' | 'active'
}
```

## Interaction Design

### Toolbar

**Position**: Below selection, flips above when insufficient space. Reuses existing `computeToolbarPosition` logic.

**Layout**:
```
[Select][Pen][Line][Rect][Ellipse][Text][Blur][Highlight][Eraser] │ [Undo][Redo] │ [Copy][Save][Close]
```

**Visual style**:
- Modern and minimal: rounded container, subtle shadow, semi-transparent background (backdrop-filter: blur)
- Tool icons use Lucide icons with consistent line style
- Active tool highlighted (background color change + subtle bottom indicator)
- Separators distinguish functional groups (annotation tools | actions | output)
- Compact but not cramped, appropriate icon spacing

**Property panel**:
- Secondary popup panel, appears above the toolbar
- Toggles on tool icon click
- Panel content changes dynamically based on active tool
- Same visual style: rounded corners, shadow, semi-transparent background
- Color presets as circular swatches, stroke width as visual line thickness indicators

### Drawing Interaction

**Continuous drawing mode**: Selected tool stays active, allowing multiple consecutive annotations of the same type.

**Smart click-to-select**: Mouse down priority logic:
1. Click on existing annotation object → select that object
2. Select tool active + click on empty area → deselect
3. Drawing tool active + click on empty area → start new drawing
4. Click on selection edge/handle → resize selection

**Selected state**: Selected object shows Konva Transformer (scale/rotate handles), can be moved, scaled, or deleted.

### Text Input

1. Click on canvas position → create HTML `<textarea>` overlaying the Canvas at that position
2. Textarea style reflects font/color/size settings in real-time
3. Confirm: click outside or Cmd+Enter
4. On confirm, convert to Konva Text node
5. Double-click existing text object → re-enter edit mode

### Blur Processing

**Rectangle mode**:
1. User drags a rectangular area
2. Extract ImageData from corresponding background region
3. Apply pixelate (mosaic) or gaussian blur algorithm
4. Render as Konva Image node

**Freehand mode**:
1. User paints a freehand path
2. Collect path points, generate clip path
3. Apply blur to ImageData within clip region
4. Render as Konva Image node with clip

Blur operates on the background snapshot, unaffected by other annotations.

### Highlight Marker

- Semi-transparent highlighter effect (opacity ~0.3-0.4)
- Implemented via Konva Line node with globalCompositeOperation or direct opacity setting
- Supports freehand and straight line modes

### Eraser

- Annotations intersected by eraser path are deleted
- Logic: eraser path intersects annotation object's bounding box → delete that object
- Each deleted object recorded as a delete command (supports undo)

### Selection Resize with Annotations

- Selection remains resizable via edge/handle dragging in annotation mode
- Konva Stage size follows selection changes
- Annotation objects use local coordinates relative to selection top-left
- Annotations exceeding selection bounds are clipped by Stage clip on export

## Keyboard Shortcuts

| Shortcut (macOS / Windows) | Action |
|---------------------------|--------|
| Cmd+Z / Ctrl+Z | Undo |
| Cmd+Shift+Z / Ctrl+Shift+Z | Redo |
| Delete / Backspace | Delete selected object |
| Cmd+C / Ctrl+C | Copy screenshot (with annotations) |
| Cmd+S / Ctrl+S | Save screenshot (with annotations) |

Note: Esc retains existing behavior (exits capture session), not used for annotation operations.

## Export Flow

```
1. User clicks Copy/Save
2. Konva stage.toBlob({ pixelRatio: scaleFactor })
   → Export annotation layer PNG (transparent background, annotations only)
3. Tauri invoke('cropAndCopy' / 'cropAndSave', {
     monitorId,
     rect,
     annotationPng: ArrayBuffer  // New parameter
   })
4. Rust side:
   a. Retrieve frozen frame from WindowMgr
   b. Crop original image by rect + scaleFactor
   c. Alpha-composite annotationPng onto cropped result
   d. Output to clipboard or file
```

## Rust-Side Changes

### Command Modifications

`cropAndCopy` and `cropAndSave` commands gain an optional parameter `annotation_png: Option<Vec<u8>>`.

When annotation layer is present:
1. Crop original image
2. Decode annotation PNG
3. Use `image` crate's `imageops::overlay` to composite
4. Output composited result

### Dependencies

No new Rust dependencies needed. The `image` crate already provides PNG decoding and alpha-composite capabilities.

## File Structure

```
src/
├── annotation/
│   ├── store.ts          # Zustand store: objects, commands, activeTool, activeStyle
│   ├── Stage.tsx         # Konva Stage container, manages Konva instance lifecycle
│   ├── tools/
│   │   ├── draw.ts       # Pen tool drawing logic
│   │   ├── line.ts       # Line tool
│   │   ├── rect.ts       # Rectangle tool
│   │   ├── ellipse.ts    # Ellipse tool
│   │   ├── text.ts       # Text tool
│   │   ├── blur.ts       # Blur tool
│   │   ├── highlight.ts  # Highlight tool
│   │   └── eraser.ts     # Eraser tool
│   ├── Toolbar.tsx       # Annotation toolbar
│   ├── PropertyPanel.tsx # Property popup panel
│   ├── commands.ts       # Undo/Redo command stack implementation
│   └── export.ts         # Export logic (stage.toBlob + IPC)
├── overlay/
│   ├── state.ts          # Extended: new annotation sub-state
│   └── ...existing
```

## Non-Goals (not included in v0.2.0)

- Annotation templates / preset saving
- Copy/paste annotation objects
- Multi-object grouping
- Annotation persistence (discarded on exit)
- Numbered sequence annotations
- Pin screenshot to desktop (Snipaste's paste feature)
