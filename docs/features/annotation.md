# Annotation

Once you've committed a selection, Flashot enters annotation mode. The annotation toolbar appears above the selected region with **13 tools** to mark up your screenshot.

## Tools Overview

| Tool | Icon | Purpose |
|------|------|---------|
| Rectangle | `□` | Draw outlined or filled rectangles |
| Ellipse | `○` | Draw outlined or filled ellipses |
| Arrow | `→` | Directional arrows with adjustable head size |
| Line | `—` | Straight lines with customizable stroke |
| Draw | `✏️` | Freehand drawing with variable stroke width |
| Text | `T` | Add text labels with font, size, and color selection |
| Marker | `#` | Numbered callout markers for sequential annotation |
| Highlight | `🖍️` | Semi-transparent highlight — two modes: freehand slanted or straight |
| Blur | `●` | Pixelate/blur sensitive information (text, faces, numbers) |
| Magnifier | `🔍` | Magnify a region of the screenshot for detail inspection |
| Spotlight | `🔦` | Dim everything except a focused area (circle or rectangle) |
| Measure | `📏` | Measure pixel distances and display dimensions |
| Eraser | `🧹` | Delete individual annotation objects by clicking on them |

Each tool persists its own style settings (stroke color, fill color, opacity, thickness, font) across sessions — the last used style for each tool is remembered.

## Drawing Workflow

1. **Select a tool** by clicking its icon in the annotation toolbar.
2. **Click and drag** on the screenshot to create the annotation object.
3. **Release** to place it on the image.
4. **Click on an existing object** to select it and adjust its properties in the property panel that appears below the toolbar.

The annotation toolbar is **draggable** — grab the grip handle on the left to reposition it anywhere on screen.

## Property Panel

When an annotation object is selected, the property panel shows its adjustable properties:

| Property | Applies To |
|----------|------------|
| Stroke color | All tools except eraser |
| Stroke width | Rectangle, Ellipse, Arrow, Line, Draw |
| Fill color | Rectangle, Ellipse |
| Fill opacity | Rectangle, Ellipse |
| Font family | Text |
| Font size | Text |
| Arrow head size | Arrow |
| Blur radius | Blur (Gaussian blur applied on export) |
| Marker number | Marker |

## Undo / Redo

- **Undo** — <kbd>Cmd</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Z</kbd>
- **Redo** — <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>

## Delete

Select an object and press **<kbd>Delete</kbd>** or **<kbd>Backspace</kbd>**, or use the Eraser tool and click on the object to remove it.

## Tool Tips

Each tool button shows a descriptive tooltip on hover. There are no keyboard shortcuts for individual tool switching — tools are selected by clicking in the toolbar.

## Annotation Persistence

Annotations are rasterized and baked into the output image when you **Copy** or **Save**. For pinned screenshots, annotations are saved as a separate layer that can be re-edited later in the pin's edit mode.
