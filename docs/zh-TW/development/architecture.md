# 架構概覽

Flashot 採用**混合架構**：Rust 後端驅動螢幕擷取、裁切和剪貼簿操作；React 前端處理覆蓋層 UI、標註和互動。

## 基於工作階段的擷取模型

核心架構模式是**基於工作階段的擷取模型**，搭配 RAII（資源獲取即初始化）守衛。

```
快速鍵觸發
     │
     ▼
並行擷取所有顯示器 (xcap) ──► 視窗列舉
     │                            │
     ▼                            │
將幀儲存為 PNG 到快取目錄       │
     │                            │
     ▼                            ▼
產生覆蓋層視窗 ────────────────► 視窗座標
(每台顯示器一個)    │                │
     │             │                │
     ▼             ▼                ▼
SessionGuard 建立 ──► 傳送 capture:start 事件
     │                   攜帶幀 + 視窗資訊
     ▼
使用者與覆蓋層互動
     │
     ▼
裁切並輸出（複製/儲存/圖釘）
     │
     ▼
SessionGuard 釋放 ──► 清理覆蓋層和幀
```

### SessionGuard

`SessionGuard` 是關鍵的 safety 機制。擷取工作階段啟動時：

1. `WindowMgr::start()` 凍結所有幀並產生覆蓋層視窗。
2. 回傳一個 `SessionGuard` —— 只要持有它，工作階段就是活躍的。
3. 當 `SessionGuard` **被釋放**時（工作階段結束或出錯），它自動：
   - 隱藏並關閉所有覆蓋層視窗
   - 從記憶體中清除所有凍結幀
   - 釋放工作階段鎖

這種 RAII 方式保證即使在 panic 或錯誤路徑上也不會發生資源洩漏。**永遠不要手動管理工作階段狀態** —— 始終使用 `SessionGuard`。

## 擷取流程（Rust → 前端 → Rust）

### 1. 快速鍵觸發

全域快速鍵（透過 `global-hotkey` crate 註冊）觸發 `lib.rs` 中的 `run_capture`：

- 使用 `xcap` 並行擷取所有顯示器
- 使用平台特定 API 列舉視窗（macOS 上使用 Core Graphics，Windows 上使用 Win32，Linux 上使用 X11）
- 將幀儲存為 PNG 到應用快取目錄
- 向每個覆蓋層視窗傳送 `capture:start` 事件，包含：
  - `monitorId` —— 此覆蓋層所屬的顯示器
  - `frameUrl` —— 凍結幀的 `asset://` URL
  - `windows` —— 轉換到顯示器本地座標的視窗座標陣列
  - `scaleFactor` —— 用於 DPI 感知的裁切

### 2. 覆蓋層互動

每台顯示器獲得獨立的 webview 視窗（標籤：`overlay-{monitor_id}`）。覆蓋層執行 **Zustand 狀態機**：

```
idle → hover → dragging → committed
  ↑                            │
  └────────── esc ─────────────┘
```

- **idle** — 等待 capture:start 事件
- **hover** — 滑鼠在凍結幀上移動；視窗偵測啟用
- **dragging** — 使用者正在繪製選取區域
- **committed** — 選取區域已確認；顯示標註和操作工具列

覆蓋層還支援 **locked**（對等顯示器宣告了選取區域）和 **scrollStarting/scrolling** 狀態。

### 3. 裁切與輸出

使用者複製或儲存時：

1. 前端呼叫 `cropAndCopy` 或 `cropAndSave`，參數包括：
   - 顯示器 ID（用於查詢凍結幀）
   - 選取區域座標（邏輯像素）
   - 可選的標註 PNG 疊加層
   - 圓角參數
   - 影像調整參數（亮度、對比度等）

2. Rust 從 `WindowMgr` 取得凍結幀，按縮放因子裁切，套用調整，合併標註，然後輸出到剪貼簿或檔案。

## 主要 Rust 模組

| 模組 | 職責 |
|--------|---------------|
| `window_mgr.rs` | 工作階段生命週期管理員。透過 `SessionGuard` 建立、持有和清理工作階段。 |
| `capture/` | 使用 `xcap` 的平台特定螢幕擷取。 |
| `window_probe/` | 用於智慧視窗偵測的平台特定視窗列舉。 |
| `hotkey.rs` | 全域快速鍵註冊，支援設定變更時即時更新。 |
| `commands.rs` | Tauri 命令處理器 —— 所有命令接收 `State<Arc<WindowMgr>>`。 |
| `tray.rs` | 系統托盤圖示和選單（擷取、設定、關於、退出）。 |
| `pin_mgr.rs` | 管理釘住的截圖視窗 —— 建立、縮放、關閉。 |
| `scroll_session.rs` | 編排滾動擷取工作階段。 |
| `scroll_stitch.rs` | 使用基於 NCC 的接縫檢測拼接捕捉的幀。 |
| `settings_store.rs` | 透過 `tauri-plugin-store` 持久化設定。 |
| `permission.rs` | 檢查和請求螢幕錄製權限（macOS）。 |

## 主要前端模組

| 模組 | 職責 |
|--------|---------------|
| `overlay/state.ts` | Zustand 狀態管理 —— 擷取覆蓋層的狀態機。 |
| `overlay/FrozenLayer.tsx` | 渲染凍結截圖，支援 SVG 濾鏡調整。 |
| `overlay/SelectionBox.tsx` | 選取矩形及調整手柄。 |
| `overlay/Toolbar.tsx` | 操作工具列（複製、儲存、圖釘、滾動、關閉）。 |
| `overlay/ColorPicker.tsx` | 懸停式取色器，支援格式切換。 |
| `overlay/ImageAdjustmentsPanel.tsx` | 亮度、對比度、飽和度、灰階控制。 |
| `overlay/CornerRadiusPanel.tsx` | 截圖圓角滑動條。 |
| `annotation/store.ts` | 標註狀態管理（物件、工具、復原/重做）。 |
| `annotation/Stage.tsx` | 基於 Konva 的畫布，用於渲染標註物件。 |
| `annotation/Toolbar.tsx` | 標註工具選擇器 + 屬性面板。 |
| `annotation/tools/` | 13 個獨立工具實作（矩形、箭頭、文字、馬賽克等）。 |
| `lib/geometry.ts` | 矩形操作的純函式（clamp、resize、hit-test）。 |
| `lib/hit-test.ts` | Z 軸視窗點選測試 —— 回傳游標位置的最頂層視窗。 |

## 多顯示器處理

每台顯示器獲得獨立的 webview 視窗。系統：

1. 並行擷取所有顯示器。
2. 每台顯示器建立一個覆蓋層視窗，標籤為 `overlay-{monitor_id}`。
3. 傳送 `capture:start` 事件，包含顯示器本地座標的視窗資訊。
4. **選取區域宣告** —— 當一個覆蓋層開始拖拽時，它宣告工作階段，其他覆蓋層顯示「鎖定」狀態。
5. 裁切時，使用顯示器 ID 查詢正確的凍結幀。

## 設定持久化

設定透過 `tauri-plugin-store` 以 JSON 格式儲存：

1. 前端呼叫 `setSettings` 命令。
2. Rust 儲存到磁碟並傳送 `settings:changed` 事件。
3. 快速鍵服務監聽此事件並重新註冊快速鍵。
4. 這使得**快速鍵即時更新**成為可能，無需重新啟動應用。

## 效能目標

| 操作 | 目標 | 目前 |
|-----------|--------|---------|
| 裁切 | < 8ms | ~748µs |
| 擷取延遲 | < 200ms | 主觀評估 |
| 覆蓋層渲染 | 60fps | CSS 變換 |
