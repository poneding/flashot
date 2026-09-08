# Flashot icons

The logo preserves the original flash: its path, size, position, gold gradients,
highlight layers, and shadow. A softly lit blue tile with a single thin edge,
a soft shadow, and raised scan corners adds depth around it. The subtle surface
grain is confined to the tile beneath the mark.

- `app-logo.svg` is the source for desktop icons and both public SVG copies.
- `menubar-logo.svg` is the original transparent macOS template source, keeping
  the flash's existing shape and scale for small menu bars.
- Windows and Linux use the colored 32 px app icon in the tray.

After editing the SVG sources, run this from the repository root:

```sh
pnpm icons:generate
```

The script uses the existing Tauri CLI to render PNG, ICO, and ICNS assets and
sync the app and documentation logos. Mobile assets are discarded. No external
image renderer is required.
