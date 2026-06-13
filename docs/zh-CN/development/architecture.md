# 架构概览

Flashot 采用**混合架构**：Rust 后端驱动屏幕截取、裁剪和剪贴板操作；React 前端处理覆盖层 UI、标注和交互。

## 基于会话的截取模型

核心架构模式是**基于会话的截取模型**，配合 RAII（资源获取即初始化）守卫。

```
快捷键触发
     │
     ▼
并行截取所有显示器 (xcap) ──► 窗口枚举
     │                            │
     ▼                            │
将帧保存为 PNG 到缓存目录        │
     │                            │
     ▼                            ▼
生成覆盖层窗口 ────────────────► 窗口坐标
(每台显示器一个)    │                │
     │             │                │
     ▼             ▼                ▼
SessionGuard 创建 ──► 发送 capture:start 事件
     │                   携带帧 + 窗口信息
     ▼
用户与覆盖层交互
     │
     ▼
裁剪并输出（复制/保存/图钉）
     │
     ▼
SessionGuard 释放 ──► 清理覆盖层和帧
```

### SessionGuard

`SessionGuard` 是关键的 safety 机制。截取会话启动时：

1. `WindowMgr::start()` 冻结所有帧并生成覆盖层窗口。
2. 返回一个 `SessionGuard` —— 只要持有它，会话就是活跃的。
3. 当 `SessionGuard` **被释放**时（会话结束或出错），它自动：
   - 隐藏并关闭所有覆盖层窗口
   - 从内存中清除所有冻结帧
   - 释放会话锁

这种 RAII 方式保证即使在 panic 或错误路径上也不会发生资源泄漏。**永远不要手动管理会话状态** —— 始终使用 `SessionGuard`。

## 截取流程（Rust → 前端 → Rust）

### 1. 快捷键触发

全局快捷键（通过 `global-hotkey` crate 注册）触发 `lib.rs` 中的 `run_capture`：

- 使用 `xcap` 并行截取所有显示器
- 使用平台特定 API 枚举窗口（macOS 上使用 Core Graphics，Windows 上使用 Win32，Linux 上使用 X11）
- 将帧保存为 PNG 到应用缓存目录
- 向每个覆盖层窗口发送 `capture:start` 事件，包含：
  - `monitorId` —— 此覆盖层所属的显示器
  - `frameUrl` —— 冻结帧的 `asset://` URL
  - `windows` —— 转换到显示器本地坐标的窗口坐标数组
  - `scaleFactor` —— 用于 DPI 感知的裁剪

### 2. 覆盖层交互

每台显示器获得独立的 webview 窗口（标签：`overlay-{monitor_id}`）。覆盖层运行 **Zustand 状态机**：

```
idle → hover → dragging → committed
  ↑                            │
  └────────── esc ─────────────┘
```

- **idle** — 等待 capture:start 事件
- **hover** — 鼠标在冻结帧上移动；窗口检测激活
- **dragging** — 用户正在绘制选区
- **committed** — 选区已确认；显示标注和操作工具栏

覆盖层还支持 **locked**（对等显示器声明了选区）和 **scrollStarting/scrolling** 状态。

### 3. 裁剪与输出

用户复制或保存时：

1. 前端调用 `cropAndCopy` 或 `cropAndSave`，参数包括：
   - 显示器 ID（用于查找冻结帧）
   - 选区坐标（逻辑像素）
   - 可选的标注 PNG 叠加层
   - 圆角参数
   - 图像调整参数（亮度、对比度等）

2. Rust 从 `WindowMgr` 获取冻结帧，按缩放因子裁剪，应用调整，合并标注，然后输出到剪贴板或文件。

## 主要 Rust 模块

| 模块 | 职责 |
|--------|---------------|
| `window_mgr.rs` | 会话生命周期管理器。通过 `SessionGuard` 创建、持有和清理会话。 |
| `capture/` | 使用 `xcap` 的平台特定屏幕截取。 |
| `window_probe/` | 用于智能窗口检测的平台特定窗口枚举。 |
| `hotkey.rs` | 全局快捷键注册，支持设置变更时实时更新。 |
| `commands.rs` | Tauri 命令处理器 —— 所有命令接收 `State<Arc<WindowMgr>>`。 |
| `tray.rs` | 系统托盘图标和菜单（截取、设置、关于、退出）。 |
| `pin_mgr.rs` | 管理钉住的截图窗口 —— 创建、缩放、关闭。 |
| `scroll_session.rs` | 编排滚动截取会话。 |
| `scroll_stitch.rs` | 使用基于 NCC 的接缝检测拼接捕获的帧。 |
| `settings_store.rs` | 通过 `tauri-plugin-store` 持久化设置。 |
| `permission.rs` | 检查和请求屏幕录制权限（macOS）。 |

## 主要前端模块

| 模块 | 职责 |
|--------|---------------|
| `overlay/state.ts` | Zustand 状态管理 —— 截取覆盖层的状态机。 |
| `overlay/FrozenLayer.tsx` | 渲染冻结截图，支持 SVG 滤镜调整。 |
| `overlay/SelectionBox.tsx` | 选区矩形及调整手柄。 |
| `overlay/Toolbar.tsx` | 操作工具栏（复制、保存、图钉、滚动、关闭）。 |
| `overlay/ColorPicker.tsx` | 悬停式取色器，支持格式切换。 |
| `overlay/ImageAdjustmentsPanel.tsx` | 亮度、对比度、饱和度、灰度控制。 |
| `overlay/CornerRadiusPanel.tsx` | 截图圆角滑动条。 |
| `annotation/store.ts` | 标注状态管理（对象、工具、撤销/重做）。 |
| `annotation/Stage.tsx` | 基于 Konva 的画布，用于渲染标注对象。 |
| `annotation/Toolbar.tsx` | 标注工具选择器 + 属性面板。 |
| `annotation/tools/` | 13 个独立工具实现（矩形、箭头、文字、马赛克等）。 |
| `lib/geometry.ts` | 矩形操作的纯函数（clamp、resize、hit-test）。 |
| `lib/hit-test.ts` | Z 轴窗口点击测试 —— 返回光标位置的最顶层窗口。 |

## 多显示器处理

每台显示器获得独立的 webview 窗口。系统：

1. 并行截取所有显示器。
2. 每台显示器创建一个覆盖层窗口，标签为 `overlay-{monitor_id}`。
3. 发送 `capture:start` 事件，包含显示器本地坐标的窗口信息。
4. **选区声明** —— 当一个覆盖层开始拖拽时，它声明会话，其他覆盖层显示"锁定"状态。
5. 裁剪时，使用显示器 ID 查找正确的冻结帧。

## 设置持久化

设置通过 `tauri-plugin-store` 以 JSON 格式存储：

1. 前端调用 `setSettings` 命令。
2. Rust 保存到磁盘并发送 `settings:changed` 事件。
3. 快捷键服务监听此事件并重新注册快捷键。
4. 这使得**快捷键实时更新**成为可能，无需重启应用。

## 性能目标

| 操作 | 目标 | 当前 |
|-----------|--------|---------|
| 裁剪 | < 8ms | ~748µs |
| 截取延迟 | < 200ms | 主观评估 |
| 覆盖层渲染 | 60fps | CSS 变换 |
