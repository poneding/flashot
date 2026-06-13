# Color Picker

Flashot includes a built-in color picker that lets you sample colors directly from your screenshot.

## Usage

1. Capture a region and commit the selection.
2. Hover the cursor over the screenshot area.
3. The color picker panel appears automatically when the overlay is in **hover** or **committed** mode.
4. Move the cursor to see the live color value update.

## Color Formats

The color picker supports three formats, toggleable by pressing <kbd>X</kbd>:

| Format | Example | Description |
|--------|---------|-------------|
| **HEX** | `#22d3ee` | Standard hexadecimal notation |
| **RGB** | `rgb(34, 211, 238)` | Red, Green, Blue (0–255) |
| **HSL** | `hsl(186, 86%, 53%)` | Hue, Saturation, Lightness |

## Copying Colors

1. Position the cursor over the desired pixel.
2. Press <kbd>C</kbd> (without any modifier) to copy the current color value to your clipboard.
3. A brief confirmation appears indicating the color was copied.

## Shortcuts

| Key | Action |
|-----|--------|
| <kbd>X</kbd> | Toggle between HEX, RGB, and HSL formats |
| <kbd>C</kbd> | Copy current color value to clipboard |

These shortcuts work as long as the color picker is active (during hover or committed mode). They work across multi-monitor setups — the overlay under the cursor handles the shortcut.

## Visual Feedback

- The color picker shows the **current color swatch** and its formatted value.
- A **copy confirmation** briefly appears after copying.
- The format indicator shows which format is currently active.
