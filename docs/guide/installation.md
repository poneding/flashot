# Installation

Flashot runs on **macOS**, **Windows**, and **Linux**. Choose your platform below.

## macOS

### Homebrew (Recommended)

```bash
brew tap poneding/flashot
brew install --cask flashot
```

### Manual Download

1. Download the latest `.dmg` from the [Releases page](https://github.com/poneding/flashot/releases).
2. Open the `.dmg` and drag **Flashot** to your **Applications** folder.
3. Grant **Screen Recording** permission when prompted:
   - Open **System Settings → Privacy & Security → Screen Recording**
   - Enable Flashot in the list
4. Restart Flashot after granting permission.

::: details Self-signed App on macOS
Flashot's macOS release builds use a fixed self-signed code-signing certificate. This is not an Apple Developer ID certificate and is not notarized, so macOS Gatekeeper may block the app on first launch.

**Option A** — Remove the quarantine attribute (recommended):

```bash
xattr -cr /Applications/Flashot.app
```

**Option B** — Right-click to open:

1. Right-click (or Control-click) **Flashot.app** in Applications
2. Select **Open** from the context menu
3. Click **Open** in the dialog that appears
:::

## Windows

1. Download the latest `.exe` installer from the [Releases page](https://github.com/poneding/flashot/releases).
2. Run the installer.
3. Launch **Flashot** from the Start Menu.

## Linux

1. Download the latest `.AppImage` from the [Releases page](https://github.com/poneding/flashot/releases).
2. Make it executable:

   ```bash
   chmod +x Flashot-*.AppImage
   ```

3. Run the AppImage:

   ```bash
   ./Flashot-*.AppImage
   ```

::: tip
For the best experience on Linux, use **X11**. Wayland support is experimental.
:::

## Verify Installation

After launching Flashot, you'll see its icon in the system tray (menu bar on macOS). You're ready to take your first screenshot — see the [Getting Started](/guide/getting-started) guide.

## Updating

### With Homebrew (macOS)

```bash
brew upgrade --cask flashot
```

### Auto-Update

Flashot includes a built-in updater. When a new version is available, you'll be notified through the tray menu via **Check for Updates**. The update is downloaded, verified, and installed automatically behind the scenes.

You can enable **automatic update checks** in the settings and optionally opt into **beta releases** for early access to new features.
