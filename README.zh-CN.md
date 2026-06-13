<div align="center">

# Flashot

[English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md)

<img src="public/app-logo.svg" alt="Flashot logo" width="128" height="128" />

**快速、轻量的截图工具，基于 Tauri + React。**

[![Release](https://img.shields.io/github/v/release/poneding/flashot?color=blue)](https://github.com/poneding/flashot/releases/latest)
[![CI](https://github.com/poneding/flashot/actions/workflows/ci.yml/badge.svg)](https://github.com/poneding/flashot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/poneding/flashot/blob/main/LICENSE)
[![Downloads](https://img.shields.io/github/downloads/poneding/flashot/total?color=green)](https://github.com/poneding/flashot/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/poneding/flashot)
[![Linux Do](https://img.shields.io/badge/Linux-DO-ffce4c)](https://linux.do)

<img src="docs/images/demo-01.png" alt="Flashot 演示" width="720" />

</div>

---

## 功能

- **全局快捷键** — 从任意位置触发区域截图、全屏快照或窗口快照
- **多显示器支持** — 从任意连接的显示器捕获画面
- **智能窗口检测** — 单击自动选择窗口边界
- **灵活选取** — 拖拽选取区域，拖拽手柄调整大小
- **快速快照** — 一键复制当前屏幕或窗口
- **复制或保存** — 发送到剪贴板或保存为 PNG
- **快捷键自定义** — 在设置中更改截图和快照快捷键
- **原生性能** — Rust 后端保证速度，React 前端保证体验

## 安装

### macOS（Homebrew）

```bash
brew tap poneding/flashot
brew install --cask flashot
```

### macOS（手动安装）

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.dmg`
2. 打开 `.dmg`，将 Flashot 拖入 Applications 文件夹
3. 授予屏幕录制权限（系统设置 → 隐私与安全性 → 屏幕录制）
4. 授予权限后重启 Flashot

### Windows

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.exe` 安装程序
2. 运行安装程序
3. 从开始菜单启动 Flashot

### Linux

1. 从 [Releases 页面](https://github.com/poneding/flashot/releases) 下载最新的 `.AppImage`
2. 赋予执行权限：`chmod +x Flashot-*.AppImage`
3. 运行 AppImage

<details>
<summary><strong>macOS 上自签名应用的说明</strong></summary>

Flashot 的 macOS 发布版本使用固定的自签名代码签名证书。这使得应用在更新之间保持更稳定的身份，但该证书不是 Apple Developer ID 证书，也未经过公证。macOS Gatekeeper 可能在首次启动时阻止应用。解决方案如下：

**方案 A** — 移除隔离属性（推荐）：

```bash
xattr -cr /Applications/Flashot.app
```

**方案 B** — 右键打开：

1. 在 Applications 文件夹中右键（或按住 Control 键单击）Flashot.app
2. 从上下文菜单中选择"打开"
3. 在弹出的对话框中点击"打开"

</details>

## 使用

| 操作 | macOS | Windows / Linux |
|------|-------|-----------------|
| 区域截图 | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| 全屏快照 | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| 窗口快照 | `Cmd+Shift+W` | `Ctrl+Shift+W` |

1. 按下区域截图快捷键
2. 屏幕冻结，叠加层出现
3. 拖拽选择区域，或点击窗口自动选择
4. 使用工具栏复制或另存，或按 **Cmd/Ctrl+C**
5. 按 **ESC** 取消

快速快照跳过叠加层，直接复制到剪贴板。

## 自动更新

Flashot 内建更新机制。当新版本可用时，您会通过系统托盘菜单中的"检查更新"收到通知。更新会自动下载、验证并安装。

如果您通过 Homebrew 安装：

```bash
brew upgrade --cask flashot
```

## 开发

### 前置要求

- **Node.js** 20 LTS 及 pnpm
- **Rust** 1.83+
- **平台依赖**：Xcode CLI Tools（macOS）/ VS Build Tools（Windows）

### 快速开始

```bash
git clone https://github.com/poneding/flashot.git
cd flashot
pnpm install
pnpm tauri dev
```

### 命令

```bash
pnpm tauri dev        # 开发模式（完整应用）
pnpm tauri build      # 生产构建
pnpm test             # 前端测试
pnpm lint             # TypeScript 类型检查
cd src-tauri && cargo clippy   # Rust 代码检查
cd src-tauri && cargo test     # Rust 测试
cd src-tauri && cargo bench    # 基准测试
```

### 架构

| 层 | 技术栈 |
|-----|-------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Rust + Tauri 2 |
| 截图 | `xcap`（跨平台） |
| 快捷键 | `global-hotkey` |
| 剪贴板 | `arboard` |
| 窗口检测 | Core Graphics（macOS）/ Win32（Windows） |

### 发布

1. 更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中的版本号
2. 提交并打标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` 工作流会构建 macOS（ARM + Intel）、Windows 和 Linux 安装包，发布 GitHub Release，然后更新 `poneding/homebrew-flashot`。Flashot 的 Rust crate 仅供 Tauri 应用内部使用，不会发布到 crates.io。

Homebrew 更新步骤会下载 `Flashot_<version>_aarch64.dmg` 和 `Flashot_<version>_x64.dmg`，计算 SHA256 哈希，并将更新后的 cask 提交到 `poneding/homebrew-flashot`。`.github/workflows/homebrew.yml` 仍是可用的手动恢复工作流。

### 测试版发布

要发布测试版，将应用版本升级为预发布 SemVer 版本，创建匹配的标签，并运行相同的发布工作流：

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

发布工作流会将包含 `-` 的标签标记为 GitHub 预发布，并将签名的更新器 `latest.json` 复制到 `beta` 分支作为 `latest.json`。启用**允许测试版更新**的用户会先检查 `https://raw.githubusercontent.com/poneding/flashot/beta/latest.json`，如果测试版清单不存在则回退到稳定版地址。未启用测试版更新的用户继续使用 GitHub Releases `latest`（不包含预发布版本）。测试版原始 URL 在首次测试版发布创建 `beta` 分支之前返回 404。

发布和手动 Homebrew 工作流需要一个名为 `HOMEBREW_TAP_TOKEN` 的仓库密钥。使用具有 `poneding/homebrew-flashot` 读写权限的细粒度个人访问令牌；默认的 `GITHUB_TOKEN` 无法推送到独立的 tap 仓库。

macOS 发布版本还需要固定的自签名代码签名密钥。生成一次证书，并将 `.p12` 文件和密码备份，以便以后版本使用相同的签名身份。

```bash
CERT_PASSWORD="选择长密码" \
  scripts/macos/create-self-signed-codesign-cert.sh /tmp/flashot-codesign.p12
```

从脚本输出中添加以下 GitHub 仓库密钥：

- `MACOS_CODESIGN_CERTIFICATE`
- `MACOS_CODESIGN_CERTIFICATE_PASSWORD`
- `MACOS_CODESIGN_IDENTITY`

这些密钥与 `TAURI_SIGNING_PRIVATE_KEY` 分开，后者签名的是更新器工件而非 macOS 应用包。

## 贡献

欢迎贡献！请：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feat/my-feature`）
3. 提交更改（`git commit -m 'feat: add my feature'`）
4. 推送到分支（`git push origin feat/my-feature`）
5. 创建 Pull Request

## 许可

[MIT](LICENSE)

## 致谢

基于 [Tauri](https://tauri.app/) · [React](https://react.dev/) · [xcap](https://github.com/nashaofu/xcap) · [global-hotkey](https://github.com/tauri-apps/global-hotkey)
