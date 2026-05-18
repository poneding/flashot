<p align="center">
  <img src="public/app-logo.svg" alt="Flashot logo" width="96" height="96" />
</p>

# Flashot

Fast, lightweight screenshot tool built with Tauri + React.

## Features

- **Global shortcuts** — Trigger region capture, active-screen quick shot, or active-window quick shot from anywhere
- **Multi-monitor support** — Capture from any connected display
- **Smart window detection** — Click to auto-select window bounds
- **Flexible selection** — Click-drag to select region, resize with handles
- **Quick shots** — Copy the active screen with Cmd/Ctrl+Shift+F or the active window with Cmd/Ctrl+Shift+W
- **Copy or save** — Send to clipboard with Cmd/Ctrl+C or the toolbar, or save as PNG with Save As
- **Customizable shortcuts** — Change capture and quick-shot keys in settings
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

1. Press the region capture shortcut (default: Cmd+Shift+A on macOS, Ctrl+Shift+A on Windows)
2. Screen freezes and overlay appears
3. Click and drag to select region, or click a window to auto-select
4. Use the toolbar to copy or Save As, or press **Cmd/Ctrl+C** after committing a selection
5. Press **ESC** to cancel

Quick shots skip the overlay and copy immediately:

- Active screen: Cmd+Shift+F on macOS, Ctrl+Shift+F on Windows/Linux
- Active window: Cmd+Shift+W on macOS, Ctrl+Shift+W on Windows/Linux

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

### Release

Flashot is released as desktop installers through GitHub Releases. The Rust
crate is internal to the Tauri app and is not published to crates.io.

To cut a release:

1. Update the version in all three files:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Commit the version bump.
3. Tag the commit with a semantic version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`. The workflow
validates that the tag matches all project versions, then builds macOS
Apple Silicon, macOS Intel, Windows, and Linux installers. It creates the
GitHub Release, uploads the installers, and generates release notes.

Maintainers can also rerun the release flow from GitHub Actions with
`workflow_dispatch` by entering an existing tag such as `v0.1.0`.

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
- Default shortcuts: Cmd+Shift+A for region capture, Cmd+Shift+F for active screen, Cmd+Shift+W for active window

### Windows

- No special permissions required
- Default shortcuts: Ctrl+Shift+A for region capture, Ctrl+Shift+F for active screen, Ctrl+Shift+W for active window

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
