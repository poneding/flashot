# 安裝

Flashot 支援 **macOS**、**Windows** 和 **Linux**。請根據您的平台選擇安裝方式。

## macOS

### Homebrew（推薦）

```bash
brew tap poneding/flashot
brew install --cask flashot
```

### 手動下載

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.dmg` 檔案。
2. 打開 `.dmg`，將 **Flashot** 拖入 **Applications** 資料夾。
3. 根據提示授予**螢幕錄製**權限：
   - 打開 **系統設定 → 隱私權與安全性 → 螢幕錄製**
   - 在清單中啟用 Flashot
4. 授予權限後重新啟動 Flashot。

::: details macOS 上自簽名應用的說明
Flashot 的 macOS 發行版本使用固定的自簽名程式碼簽章憑證。此憑證不是 Apple Developer ID 憑證，未經過公證，因此 macOS Gatekeeper 可能在首次啟動時阻擋應用。

**方案 A** — 移除隔離屬性（推薦）：

```bash
xattr -cr /Applications/Flashot.app
```

**方案 B** — 右鍵打開：

1. 在 Applications 資料夾中右鍵（或按住 Control 鍵點按）**Flashot.app**
2. 從上下文選單中選擇**打開**
3. 在彈出的對話框中點選**打開**
:::

## Windows

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.exe` 安裝程式。
2. 執行安裝程式。
3. 從開始選單啟動 **Flashot**。

## Linux

1. 從 [Releases 頁面](https://github.com/poneding/flashot/releases) 下載最新的 `.AppImage` 檔案。
2. 賦予執行權限：

   ```bash
   chmod +x Flashot-*.AppImage
   ```

3. 執行 AppImage：

   ```bash
   ./Flashot-*.AppImage
   ```

::: tip
在 Linux 上建議使用 **X11** 以獲得最佳體驗。Wayland 支援為實驗性功能。
:::

## 驗證安裝

啟動 Flashot 後，您會在系統托盤（macOS 上為選單列）中看到它的圖示。現在可以開始擷取了 —— 請參閱[快速上手](/zh-TW/guide/getting-started)指南。

## 更新

### 使用 Homebrew（macOS）

```bash
brew upgrade --cask flashot
```

### 自動更新

Flashot 內建更新機制。當新版本可用時，您會透過系統托盤選單中的**檢查更新**收到通知。更新會在背景自動下載、驗證並安裝。

您可以在設定中啟用**自動檢查更新**，並可選擇加入**測試版**以搶先體驗新功能。
