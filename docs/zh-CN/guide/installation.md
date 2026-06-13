# 安装

Flashot 支持 **macOS**、**Windows** 和 **Linux**。请根据您的平台选择安装方式。

## macOS

### Homebrew（推荐）

```bash
brew tap poneding/flashot
brew install --cask flashot
```

### 手动下载

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.dmg` 文件。
2. 打开 `.dmg`，将 **Flashot** 拖入 **Applications** 文件夹。
3. 根据提示授予**屏幕录制**权限：
   - 打开 **系统设置 → 隐私与安全性 → 屏幕录制**
   - 在列表中启用 Flashot
4. 授予权限后重启 Flashot。

::: details macOS 上自签名应用的说明
Flashot 的 macOS 发布版本使用固定的自签名代码签名证书。此证书不是 Apple Developer ID 证书，未经过公证，因此 macOS Gatekeeper 可能在首次启动时阻止应用。

**方案 A** — 移除隔离属性（推荐）：

```bash
xattr -cr /Applications/Flashot.app
```

**方案 B** — 右键打开：

1. 在 Applications 文件夹中右键（或按住 Control 键单击）**Flashot.app**
2. 从上下文菜单中选择**打开**
3. 在弹出的对话框中点击**打开**
:::

## Windows

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.exe` 安装程序。
2. 运行安装程序。
3. 从开始菜单启动 **Flashot**。

## Linux

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.AppImage` 文件。
2. 赋予执行权限：

   ```bash
   chmod +x Flashot-*.AppImage
   ```

3. 运行 AppImage：

   ```bash
   ./Flashot-*.AppImage
   ```

::: tip
在 Linux 上建议使用 **X11** 以获得最佳体验。Wayland 支持为实验性功能。
:::

## 验证安装

启动 Flashot 后，您会在系统托盘（macOS 上为菜单栏）中看到它的图标。现在可以开始截图了 —— 请参阅[快速上手](/zh-CN/guide/getting-started)指南。

## 更新

### 使用 Homebrew（macOS）

```bash
brew upgrade --cask flashot
```

### 自动更新

Flashot 内置更新机制。当新版本可用时，您会通过系统托盘菜单中的**检查更新**收到通知。更新会在后台自动下载、验证并安装。

您可以在设置中启用**自动检查更新**，并可选择加入**测试版**以抢先体验新功能。
