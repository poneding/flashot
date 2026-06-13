# Screen Capture

Flashot offers three capture modes, each triggered by a global hotkey.

## Region Capture

The primary capture mode. Press the region hotkey to freeze the screen and enter the overlay.

1. The screen dims, showing all monitors with frozen frames.
2. **Click and drag** to draw a selection rectangle.
3. **Release** the mouse to commit the selection.
4. The annotation toolbar and action toolbar appear.

### Smart Window Detection

Hover over any visible window — Flashot automatically highlights its bounds. **Click once** on a highlighted window to select it instantly, skipping the manual drag.

This works across all monitors and uses z-order hit-testing to identify the topmost window under the cursor.

### Selection Manipulation

Once a region is selected:

- **Resize** — Drag any of the 8 handles (corners + edges) to adjust the selection.
- **Move** — Click and drag inside the selected area to reposition it.
- **Corner radius** — Adjust the roundness of screenshot corners via the toolbar slider.

## Full Screen Quick Shot

Press the full screen hotkey to capture your **primary monitor** instantly. The screenshot is copied to your clipboard immediately — no overlay, no interaction.

On multi-monitor setups, only the primary display is captured by the default hotkey. Use region capture for other monitors.

## Active Window Quick Shot

Press the active window hotkey to capture the **frontmost window** on your primary monitor. Like the full screen quick shot, the result is copied to your clipboard instantly.

This is useful for capturing dialog boxes, individual app windows, or any focused UI element without manual selection.

## Output

### Copy to Clipboard

After a region capture, click **Copy** (<kbd>Cmd</kbd> + <kbd>C</kbd>) to send the screenshot to your clipboard. You can paste it directly into any application (documents, chat, image editors).

Quick shots copy automatically — no extra steps needed.

### Save as PNG

Click **Save** (<kbd>Cmd</kbd> + <kbd>S</kbd>) to save the screenshot to your configured default directory. A file dialog opens for the first save; subsequent saves use the last-used directory.

The default save location is `~/Pictures/Flashot/`. Change it in [Settings](/guide/settings).

### Pin as Floating Window

Click **Pin** to turn the screenshot into a floating window that stays on top of other applications. Pinned screenshots can be annotated, adjusted, zoomed, and resized — see the [Pin](/features/pin) feature page for details.

## Multi-Monitor Support

Flashot captures **all connected monitors** simultaneously when you trigger region capture. Each monitor gets its own overlay window with the correct frame and scale factor. You can select from any monitor seamlessly — the cursor tracks which overlay should be interactive.

The capture system handles:

- Different resolutions and scale factors across monitors
- Non-trivial monitor arrangements (side-by-side, stacked, mixed)
- Full set of monitor information (rect, scale factor, identifier)
