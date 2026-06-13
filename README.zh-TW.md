<div align="center">

# Flashot

[English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文**

<img src="public/app-logo.svg" alt="Flashot logo" width="128" height="128" />

**快速、輕量的截圖工具，基於 Tauri + React。**

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

- **全域快捷鍵** — 從任何位置觸發區域截圖、全螢幕快照或視窗快照
- **多顯示器支援** — 從任意連接的顯示器擷取畫面
- **智慧視窗偵測** — 按一下自動選擇視窗邊界
- **靈活選取** — 拖曳選取區域，拖曳手柄調整大小
- **快速快照** — 一鍵複製目前螢幕或視窗
- **複製或儲存** — 傳送到剪貼簿或儲存為 PNG
- **快捷鍵自訂** — 在設定中更改截圖和快照快捷鍵
- **原生效能** — Rust 後端保證速度，React 前端保證體驗

## 安裝

### macOS（Homebrew）

```bash
brew tap poneding/flashot
brew install --cask flashot
```

### macOS（手動安裝）

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.dmg`
2. 開啟 `.dmg`，將 Flashot 拖入 Applications 資料夾
3. 授予螢幕錄製權限（系統設定 → 隱私與安全性 → 螢幕錄製）
4. 授予權限後重新啟動 Flashot

### Windows

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.exe` 安裝程式
2. 執行安裝程式
3. 從開始功能表啟動 Flashot

### Linux

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.AppImage`
2. 賦予執行權限：`chmod +x Flashot-*.AppImage`
3. 執行 AppImage

<details>
<summary><strong>macOS 上自簽名應用程式的說明</strong></summary>

Flashot 的 macOS 發布版本使用固定的自簽名程式碼簽署憑證。這使得應用程式在更新之間保持更穩定的身分，但該憑證不是 Apple Developer ID 憑證，也未經過公證。macOS Gatekeeper 可能在首次啟動時阻止應用程式。解決方案如下：

**方案 A** — 移除隔離屬性（推薦）：

```bash
xattr -cr /Applications/Flashot.app
```

**方案 B** — 右鍵開啟：

1. 在 Applications 資料夾中右鍵（或按住 Control 鍵按一下）Flashot.app
2. 從上下文選單中選擇「開啟」
3. 在彈出的對話方塊中按一下「開啟」

</details>

## 使用

| 操作 | macOS | Windows / Linux |
|------|-------|-----------------|
| 區域截圖 | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| 全螢幕快照 | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| 視窗快照 | `Cmd+Shift+W` | `Ctrl+Shift+W` |

1. 按下區域截圖快捷鍵
2. 畫面凍結，疊加層出現
3. 拖曳選擇區域，或按一下視窗自動選擇
4. 使用工具列複製或另存，或按 **Cmd/Ctrl+C**
5. 按 **ESC** 取消

快速快照跳過疊加層，直接複製到剪貼簿。

## 自動更新

Flashot 內建更新機制。當新版本可用時，您會透過系統匣選單中的「檢查更新」收到通知。更新會自動下載、驗證並安裝。

如果您透過 Homebrew 安裝：

```bash
brew upgrade --cask flashot
```

## 開發

### 前置需求

- **Node.js** 20 LTS 及 pnpm
- **Rust** 1.83+
- **平台依賴**：Xcode CLI Tools（macOS）/ VS Build Tools（Windows）

### 快速開始

```bash
git clone https://github.com/poneding/flashot.git
cd flashot
pnpm install
pnpm tauri dev
```

### 命令

```bash
pnpm tauri dev        # 開發模式（完整應用程式）
pnpm tauri build      # 生產建構
pnpm test             # 前端測試
pnpm lint             # TypeScript 型別檢查
cd src-tauri && cargo clippy   # Rust 程式碼檢查
cd src-tauri && cargo test     # Rust 測試
cd src-tauri && cargo bench    # 基準測試
```

### 架構

| 層 | 技術棧 |
|-----|-------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 後端 | Rust + Tauri 2 |
| 截圖 | `xcap`（跨平台） |
| 快捷鍵 | `global-hotkey` |
| 剪貼簿 | `arboard` |
| 視窗偵測 | Core Graphics（macOS）/ Win32（Windows） |

### 發佈

1. 更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 中的版本號
2. 提交並打標籤：

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` 工作流程會建構 macOS（ARM + Intel）、Windows 和 Linux 安裝套件，發佈 GitHub Release，然後更新 `poneding/homebrew-flashot`。Flashot 的 Rust crate 僅供 Tauri 應用程式內部使用，不會發佈到 crates.io。

Homebrew 更新步驟會下載 `Flashot_<version>_aarch64.dmg` 和 `Flashot_<version>_x64.dmg`，計算 SHA256 雜湊值，並將更新後的 cask 提交到 `poneding/homebrew-flashot`。`.github/workflows/homebrew.yml` 仍是可用的手動復原工作流程。

### 測試版發佈

要發佈測試版，將應用程式版本升級為預發佈 SemVer 版本，建立相符的標籤，並執行相同的發佈工作流程：

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

發佈工作流程會將包含 `-` 的標籤標記為 GitHub 預發佈，並將簽署的更新程式 `latest.json` 複製到 `beta` 分支作為 `latest.json`。啟用**允許測試版更新**的使用者會先檢查 `https://raw.githubusercontent.com/poneding/flashot/beta/latest.json`，如果測試版清單不存在則回退到穩定版位址。未啟用測試版更新的使用者繼續使用 GitHub Releases `latest`（不包含預發佈版本）。測試版原始 URL 在首次測試版發佈建立 `beta` 分支之前傳回 404。

發佈和手動 Homebrew 工作流程需要一個名為 `HOMEBREW_TAP_TOKEN` 的儲存庫密鑰。使用具有 `poneding/homebrew-flashot` 讀寫權限的細粒度個人存取權杖；預設的 `GITHUB_TOKEN` 無法推送到獨立的 tap 儲存庫。

macOS 發佈版本還需要固定的自簽名程式碼簽署密鑰。產生一次憑證，並將 `.p12` 檔案和密碼備份，以便日後版本使用相同的簽署身分。

```bash
CERT_PASSWORD="選擇長密碼" \
  scripts/macos/create-self-signed-codesign-cert.sh /tmp/flashot-codesign.p12
```

從腳本輸出中新增以下 GitHub 儲存庫密鑰：

- `MACOS_CODESIGN_CERTIFICATE`
- `MACOS_CODESIGN_CERTIFICATE_PASSWORD`
- `MACOS_CODESIGN_IDENTITY`

這些密鑰與 `TAURI_SIGNING_PRIVATE_KEY` 分開，後者簽署的是更新程式工件而非 macOS 應用程式套件。

## 貢獻

歡迎貢獻！請：

1. Fork 本儲存庫
2. 建立特性分支（`git checkout -b feat/my-feature`）
3. 提交更改（`git commit -m 'feat: add my feature'`）
4. 推送到分支（`git push origin feat/my-feature`）
5. 建立 Pull Request

## 授權

[MIT](LICENSE)

## 致謝

基於 [Tauri](https://tauri.app/) · [React](https://react.dev/) · [xcap](https://github.com/nashaofu/xcap) · [global-hotkey](https://github.com/tauri-apps/global-hotkey)
