# onnxruntime bundled libraries

These directories ship platform-specific onnxruntime dynamic libraries inside
the Tauri bundle. Each Flashot release pins a single onnxruntime version.

## Pinned version

onnxruntime 1.22.0 (matches `ort = "2.0.0-rc.10"` / `ort-sys = "2.0.0-rc.10"`)

## How to populate

Download the official prebuilt binaries from
https://github.com/microsoft/onnxruntime/releases/tag/v1.22.0 and copy:

| Platform | File | Target |
|---|---|---|
| macOS (universal) | `libonnxruntime.1.22.0.dylib` | `macos/libonnxruntime.dylib` |
| Windows x64 | `onnxruntime.dll` | `windows/onnxruntime.dll` |
| Linux x64 | `libonnxruntime.so.1.22.0` | `linux/libonnxruntime.so` |

The files are **not** committed to git (see `.gitignore`); CI fetches them on
demand. Local development requires them to be present before running
`pnpm tauri build`. `cargo check` and `pnpm tauri dev` work without them, but
OCR features will fail at runtime if the dylib path resolved by Task 3 is
empty.

## Bundle layout

Tauri's `bundle.resources` field validates source paths at `cargo check` time,
so we use per-platform `bundle.<platform>.files` instead. This way `cargo
check` on macOS does not fail because of a missing Linux `.so`.

- macOS: copied into `Flashot.app/Contents/Frameworks/libonnxruntime.dylib`
- Linux (deb/appimage): installed at `/usr/lib/flashot/libonnxruntime.so`
- Windows: bundling handled at release-packaging time (NSIS/WiX), not in
  `tauri.conf.json`. Place `onnxruntime.dll` next to `flashot.exe` in the
  installer staging step. Task 3's loader will look beside the executable
  first, then fall back to `windows/onnxruntime.dll` during dev.
