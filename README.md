# Flashot

Fast, lightweight screenshot tool built with Tauri + React.

## Features

- **Global hotkey** — Trigger capture from anywhere (default: Cmd+Shift+A on macOS, Ctrl+Shift+A on Windows)
- **Multi-monitor support** — Capture from any connected display
- **Smart window detection** — Click to auto-select window bounds
- **Flexible selection** — Click-drag to select region, resize with handles
- **Copy or save** — Send to clipboard with Cmd/Ctrl+C or the toolbar, or save as PNG with Save As
- **Customizable hotkey** — Change trigger key in settings
- **Native performance** — Rust backend for speed, React frontend for polish

## Installation

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/poneding/flashot/releases)
2. Open the `.dmg` and drag Flashot to Applications
3. Launch Flashot
4. Grant screen recording permission when prompted (System Settings → Privacy & Security → Screen Recording)
5. Restart Flashot after granting permission

### Windows

1. Download the latest `.msi` installer from [Releases](https://github.com/poneding/flashot/releases)
2. Run the installer
3. Launch Flashot from Start Menu

## Usage

1. Press the hotkey (default: Cmd+Shift+A on macOS, Ctrl+Shift+A on Windows)
2. Screen freezes and overlay appears
3. Click and drag to select region, or click a window to auto-select
4. Use the toolbar to copy or Save As, or press **Cmd/Ctrl+C** after committing a selection
5. Press **ESC** to cancel

## Development

### Prerequisites

- **Node.js** 20 LTS and pnpm
- **Rust** 1.83+
- **Platform-specific dependencies**:
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools

### Setup

```bash
# Clone the repository
git clone https://github.com/poneding/flashot.git
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
- **Window detection**: Platform-specific APIs (Core Graphics on macOS, Win32 on Windows)

## Platform Notes

### macOS

- Requires screen recording permission (granted on first launch)
- Uses private APIs for overlay rendering (`macOSPrivateApi: true`)
- Default hotkey: Cmd+Shift+A

### Windows

- No special permissions required
- Default hotkey: Ctrl+Shift+A

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
