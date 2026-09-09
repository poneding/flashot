# Flashot icons

The logo preserves the original flash: its path, size, position, gold gradients,
highlight layers, and shadow. A softly lit blue tile with a single thin, solid edge,
a soft shadow, and raised scan corners adds depth around it. The subtle surface
grain is confined to the tile beneath the mark.

- `app-logo.svg` is the source for desktop icons and both public SVG copies.
- `public/app-logo-{48,96,144}.png` are pre-rendered from the same SVG for the
  48 CSS px About and Updates panel image. The panels select 1x, 2x, or 3x via
  `srcSet`, keeping thin-border antialiasing predictable without relying on
  small-size SVG filter and clip-path rendering.
- `menubar-logo.svg` is the original transparent macOS template source, keeping
  the flash's existing shape and scale for small menu bars.
- `menubar-colored-logo.svg` is the dedicated Windows / Linux tray source. Its
  16 px grid, two-pixel scan strokes, and solid colors stay readable when the
  exported 32 px PNG is scaled down by the system panel. The flash keeps its
  original path, and the dark plate provides contrast on light and dark panels.

After editing the SVG sources, run this from the repository root:

```sh
pnpm icons:generate
```

The script uses the existing Tauri CLI to render PNG, ICO, and ICNS assets and
sync the app and documentation logos. Mobile assets are discarded. No external
image renderer is required.
