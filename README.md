# Flashot

Fast, lightweight screenshot tool built with Tauri + React.

## Features

- **Global hotkey** — Trigger capture from anywhere (default: Cmd+Shift+5 on macOS)
- **Multi-monitor support** — Capture from any connected display
- **Smart window detection** — Click to auto-select window bounds
- **Flexible selection** — Click-drag to select region, resize with handles
- **Copy or save** — Send to clipboard (Enter) or save as PNG (Cmd+S)
- **Customizable hotkey** — Change trigger key in settings
- **Native performance** — Rust backend for speed, React frontend for polish

## Installation

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/yourusername/flashot/releases)
2. Open the `.dmg` and drag Flashot to Applications
3. Launch Flashot
4. Grant screen recording permission when prompted (System Settings → Privacy & Security → Screen Recording)
5. Restart Flashot after granting permission

### Windows

1. Download the latest `.msi` installer from [Releases](https://github.com/yourusername/flashot/releases)
2. Run the installer
3. Launch Flashot from Start Menu

### Linux

1. Download the latest `.AppImage` or `.deb` from [Releases](https://github.com/yourusername/flashot/releases)
2. Make executable: `chmod +x Flashot.AppImage`
3. Run: `./Flashot.AppImage`

**Note**: X11 is recommended. Wayland support is experimental.

## Usage

1. Press the hotkey (default: Cmd+Shift+5 on macOS)
2. Screen freezes and overlay appears
3. Click and drag to select region, or click a window to auto-select
4. Press **Enter** to copy to clipboard, or **Cmd+S** to save as PNG
5. Press **ESC** to cancel

## Development

### Prerequisites

- **Node.js** 18+ and pnpm
- **Rust** 1.70+
- **Platform-specific dependencies**:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools
  - Linux: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/flashot.git
cd flashot

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev
```

### Build

```bash
# Build for production
pnpm tauri build
```

Output will be in `src-tauri/target/release/bundle/`.

### Testing

```bash
# Run frontend tests
pnpm test

# Run Rust tests
cd src-tauri && cargo test

# Run benchmarks
cd src-tauri && cargo bench
```

### Code Quality

```bash
# TypeScript type checking
pnpm lint

# Rust linting
cd src-tauri && cargo clippy
```

## Architecture

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Rust + Tauri
- **Screen capture**: `xcap` (cross-platform)
- **Hotkey**: `global-hotkey`
- **Clipboard**: `arboard`
- **Window detection**: Platform-specific APIs (Core Graphics on macOS, Win32 on Windows, X11 on Linux)

## Platform Notes

### macOS

- Requires screen recording permission (granted on first launch)
- Uses private APIs for overlay rendering (`macOSPrivateApi: true`)
- Default hotkey conflicts with native screenshot tool (user must choose)

### Windows

- No special permissions required
- Default hotkey conflicts with Snipping Tool (user must choose)

### Linux

- X11 recommended (Wayland support experimental)
- Tray icon may not work on all desktop environments

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:
- [Tauri](https://tauri.app/) — Desktop app framework
- [React](https://react.dev/) — UI library
- [xcap](https://github.com/nashaofu/xcap) — Screen capture
- [global-hotkey](https://github.com/tauri-apps/global-hotkey) — Hotkey registration
