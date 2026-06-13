# 環境建置

Flashot 基於 **Tauri 2**（Rust 後端）+ **React**（TypeScript 前端）建構。本文介紹如何搭建開發環境。

## 環境需求

### 系統依賴

**macOS：**

```bash
xcode-select --install
```

**Windows：**

- Microsoft Visual Studio C++ Build Tools（或安裝包含「使用 C++ 的桌面開發」工作負載的 Visual Studio）
- WebView2（Windows 10 1803+ 已內建）

**Linux（Ubuntu/Debian）：**

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev libgbm-dev
```

其他發行版：請參閱 [Tauri 2 環境需求指南](https://v2.tauri.app/start/prerequisites/)。

### Node.js

- **Node.js** 20 LTS 或更新版本
- **pnpm**（使用 `npm install -g pnpm` 安裝）

### Rust

- **Rust** 1.83+（透過 [rustup](https://rustup.rs/) 安裝）

```bash
rustup update stable
```

## 克隆與安裝

```bash
git clone https://github.com/poneding/flashot.git
cd flashot
pnpm install
```

## 開發命令

### 執行完整應用

```bash
pnpm tauri dev
```

這將啟動 Vite 開發伺服器（前端熱更新）並啟動 Tauri 桌面應用。前端程式碼修改後熱更新；Rust 修改後觸發重新編譯。

### 僅前端開發

```bash
pnpm dev
```

在 `http://localhost:1420` 啟動 Vite 開發伺服器。可在瀏覽器中預覽 UI，但 Tauri API 在沒有原生上下文的情況下無法運作。

### 測試

```bash
# 前端測試（Vitest）
pnpm test
pnpm test:watch       # 觀察模式

# Rust 測試
cd src-tauri && cargo test
```

### 程式碼檢查

```bash
# TypeScript
pnpm lint

# Rust
cd src-tauri && cargo clippy
```

### 基準測試

```bash
cd src-tauri
cargo bench                    # 所有基準測試
cargo bench --bench crop_bench # 僅裁切操作
```

可用基準測試：

| 基準測試 | 說明 | CI |
|-----------|-------------|-----|
| `crop_bench` | 純 CPU 裁切效能 | ✅ 是 |
| `capture_bench` | 螢幕擷取速度 | ❌ 需要顯示器 |
| `window_enum_bench` | 視窗列舉速度 | ❌ 需要顯示器 |
| `clipboard_bench` | 剪貼簿寫入速度 | ❌ 需要顯示器 |
| `scroll_stitch_bench` | 滾動拼接效能 | ❌ 需要顯示器 |

## 生產建置

```bash
pnpm tauri build
```

建置前端、編譯 Rust 後端的發行模式，並將應用打包為平台特定的安裝程式：
- **macOS**：`.dmg`
- **Windows**：`.exe`（NSIS 安裝程式）
- **Linux**：`.deb` + `.AppImage`

## 專案結構

```
flashot/
├── src/                      # 前端（React + TypeScript）
│   ├── annotation/           # 標註工具和狀態管理
│   ├── components/           # 共用 UI 元件
│   ├── i18n/                 # 國際化
│   ├── lib/                  # 工具函式和 IPC 封裝
│   ├── overlay/              # 擷取覆蓋層元件
│   ├── routes/               # 應用路由（overlay、pin、settings 等）
│   ├── settings/             # 設定 UI 元件
│   └── styles/               # 全域樣式
├── src-tauri/                # 後端（Rust）
│   ├── src/
│   │   ├── capture/          # 平台螢幕擷取
│   │   ├── window_probe/     # 平台視窗列舉
│   │   ├── commands.rs       # Tauri 命令處理器
│   │   ├── hotkey.rs         # 全域快速鍵註冊
│   │   ├── lib.rs            # 應用設定和事件處理
│   │   ├── tray.rs           # 系統托盤
│   │   └── window_mgr.rs     # 工作階段生命週期管理
│   ├── benches/              # Criterion 基準測試
│   └── tauri.conf.json       # Tauri 設定
├── docs/                     # 文件站點（VitePress）
└── .github/                  # CI/CD 工作流程
```
