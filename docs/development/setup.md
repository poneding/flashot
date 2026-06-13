# Development Setup

Flashot is built with **Tauri 2** (Rust backend) + **React** (TypeScript frontend). This guide walks through setting up a development environment.

## Prerequisites

### System Dependencies

**macOS:**

```bash
xcode-select --install
```

**Windows:**

- Microsoft Visual Studio C++ Build Tools (or Visual Studio with "Desktop development with C++" workload)
- WebView2 (included on Windows 10 1803+)

**Linux (Ubuntu/Debian):**

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev libgbm-dev
```

Other distributions: see the [Tauri 2 prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### Node.js

- **Node.js** 20 LTS or later
- **pnpm** (install with `npm install -g pnpm`)

### Rust

- **Rust** 1.83+ (install via [rustup](https://rustup.rs/))

```bash
rustup update stable
```

## Clone & Install

```bash
git clone https://github.com/poneding/flashot.git
cd flashot
pnpm install
```

## Development Commands

### Run the Full App

```bash
pnpm tauri dev
```

This starts the Vite dev server (frontend HMR) and launches the Tauri desktop app. Changes to frontend code hot-reload; Rust changes trigger a rebuild.

### Frontend-Only Development

```bash
pnpm dev
```

Runs the Vite dev server at `http://localhost:1420`. The UI can be previewed in a browser, but Tauri APIs won't work without the native context.

### Testing

```bash
# Frontend tests (Vitest)
pnpm test
pnpm test:watch       # Watch mode

# Rust tests
cd src-tauri && cargo test
```

### Linting

```bash
# TypeScript
pnpm lint

# Rust
cd src-tauri && cargo clippy
```

### Benchmarks

```bash
cd src-tauri
cargo bench                    # All benchmarks
cargo bench --bench crop_bench # Crop operation only
```

Available benchmarks:

| Benchmark | Description | CI |
|-----------|-------------|-----|
| `crop_bench` | Pure CPU crop performance | ✅ Yes |
| `capture_bench` | Screen capture speed | ❌ Requires display |
| `window_enum_bench` | Window enumeration speed | ❌ Requires display |
| `clipboard_bench` | Clipboard write speed | ❌ Requires display |
| `scroll_stitch_bench` | Scroll stitching performance | ❌ Requires display |

## Production Build

```bash
pnpm tauri build
```

Builds the frontend, compiles the Rust backend in release mode, and packages the app into platform-specific installers:
- **macOS**: `.dmg`
- **Windows**: `.exe` (NSIS installer)
- **Linux**: `.deb` + `.AppImage`

## Project Structure

```
flashot/
├── src/                      # Frontend (React + TypeScript)
│   ├── annotation/           # Annotation tools and state
│   ├── components/           # Shared UI components
│   ├── i18n/                 # Internationalization
│   ├── lib/                  # Utilities and IPC wrappers
│   ├── overlay/              # Capture overlay components
│   ├── routes/               # App routes (overlay, pin, settings, etc.)
│   ├── settings/             # Settings UI components
│   └── styles/               # Global styles
├── src-tauri/                # Backend (Rust)
│   ├── src/
│   │   ├── capture/          # Platform screen capture
│   │   ├── window_probe/     # Platform window enumeration
│   │   ├── commands.rs       # Tauri command handlers
│   │   ├── hotkey.rs         # Global hotkey registration
│   │   ├── lib.rs            # App setup and event handlers
│   │   ├── tray.rs           # System tray
│   │   └── window_mgr.rs     # Session lifecycle manager
│   ├── benches/              # Criterion benchmarks
│   └── tauri.conf.json       # Tauri configuration
├── docs/                     # Documentation site (VitePress)
└── .github/                  # CI/CD workflows
```
