# 环境搭建

Flashot 基于 **Tauri 2**（Rust 后端）+ **React**（TypeScript 前端）构建。本文档介绍如何搭建开发环境。

## 环境要求

### 系统依赖

**macOS：**

```bash
xcode-select --install
```

**Windows：**

- Microsoft Visual Studio C++ Build Tools（或安装包含"使用 C++ 的桌面开发"工作负载的 Visual Studio）
- WebView2（Windows 10 1803+ 已内置）

**Linux（Ubuntu/Debian）：**

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libpipewire-0.3-dev libgbm-dev
```

其他发行版：请参阅 [Tauri 2 环境要求指南](https://v2.tauri.app/start/prerequisites/)。

### Node.js

- **Node.js** 20 LTS 或更新版本
- **pnpm**（使用 `npm install -g pnpm` 安装）

### Rust

- **Rust** 1.83+（通过 [rustup](https://rustup.rs/) 安装）

```bash
rustup update stable
```

## 克隆与安装

```bash
git clone https://github.com/poneding/flashot.git
cd flashot
pnpm install
```

## 开发命令

### 运行完整应用

```bash
pnpm tauri dev
```

这将启动 Vite 开发服务器（前端热更新）并启动 Tauri 桌面应用。前端代码修改后热更新；Rust 修改后触发重新编译。

### 仅前端开发

```bash
pnpm dev
```

在 `http://localhost:1420` 启动 Vite 开发服务器。可在浏览器中预览 UI，但 Tauri API 在没有原生上下文的情况下无法工作。

### 测试

```bash
# 前端测试（Vitest）
pnpm test
pnpm test:watch       # 观察模式

# Rust 测试
cd src-tauri && cargo test
```

### 代码检查

```bash
# TypeScript
pnpm lint

# Rust
cd src-tauri && cargo clippy
```

### 基准测试

```bash
cd src-tauri
cargo bench                    # 所有基准测试
cargo bench --bench crop_bench # 仅裁剪操作
```

可用基准测试：

| 基准测试 | 说明 | CI |
|-----------|-------------|-----|
| `crop_bench` | 纯 CPU 裁剪性能 | ✅ 是 |
| `capture_bench` | 屏幕截取速度 | ❌ 需要显示器 |
| `window_enum_bench` | 窗口枚举速度 | ❌ 需要显示器 |
| `clipboard_bench` | 剪贴板写入速度 | ❌ 需要显示器 |
| `scroll_stitch_bench` | 滚动拼接性能 | ❌ 需要显示器 |

## 生产构建

```bash
pnpm tauri build
```

构建前端、编译 Rust 后端的发布模式，并将应用打包为平台特定的安装程序：
- **macOS**：`.dmg`
- **Windows**：`.exe`（NSIS 安装程序）
- **Linux**：`.deb` + `.AppImage`

## 项目结构

```
flashot/
├── src/                      # 前端（React + TypeScript）
│   ├── annotation/           # 标注工具和状态管理
│   ├── components/           # 共享 UI 组件
│   ├── i18n/                 # 国际化
│   ├── lib/                  # 工具函数和 IPC 封装
│   ├── overlay/              # 截取覆盖层组件
│   ├── routes/               # 应用路由（overlay、pin、settings 等）
│   ├── settings/             # 设置 UI 组件
│   └── styles/               # 全局样式
├── src-tauri/                # 后端（Rust）
│   ├── src/
│   │   ├── capture/          # 平台屏幕截取
│   │   ├── window_probe/     # 平台窗口枚举
│   │   ├── commands.rs       # Tauri 命令处理器
│   │   ├── hotkey.rs         # 全局快捷键注册
│   │   ├── lib.rs            # 应用设置和事件处理
│   │   ├── tray.rs           # 系统托盘
│   │   └── window_mgr.rs     # 会话生命周期管理
│   ├── benches/              # Criterion 基准测试
│   └── tauri.conf.json       # Tauri 配置
├── docs/                     # 文档站点（VitePress）
└── .github/                  # CI/CD 工作流
```
