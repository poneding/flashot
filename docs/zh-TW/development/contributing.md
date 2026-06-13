# 貢獻指南

歡迎貢獻！無論是錯誤修復、新功能還是文件改進，您的幫助都會讓 Flashot 變得更好。

## 開始

1. 在 GitHub 上 **Fork** 本倉庫。
2. **克隆** 您的 Fork：

   ```bash
   git clone https://github.com/your-username/flashot.git
   cd flashot
   ```

3. **搭建**開發環境 —— 參見[環境建置](/zh-TW/development/setup)指南。
4. **建立功能分支**：

   ```bash
   git checkout -b feat/my-feature
   ```

## 開發工作流程

1. 進行修改。
2. 執行測試：

   ```bash
   pnpm test              # 前端測試
   cd src-tauri && cargo test  # Rust 測試
   ```

3. 執行程式碼檢查：

   ```bash
   pnpm lint                     # TypeScript
   cd src-tauri && cargo clippy  # Rust
   ```

4. 驗證建置：

   ```bash
   pnpm tauri build
   ```

## 提交規範

Flashot 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 規範：

```
<type>: <description>

[optional body]
[optional footer]
```

### 類型

| 類型 | 用途 |
|------|-------|
| `feat` | 面向使用者的新功能 |
| `fix` | 面向使用者的錯誤修復 |
| `docs` | 文件變更 |
| `style` | 程式碼風格（格式化等） |
| `refactor` | 不影響功能的重構 |
| `perf` | 效能改進 |
| `test` | 新增或更新測試 |
| `chore` | 維護工作（依賴、建置設定、CI） |
| `ci` | CI/CD 設定變更 |

### 範例

```
feat: add color picker to crosshair cursor
fix: resolve memory leak in session cleanup
refactor: extract window detection logic to separate module
docs: update installation guide for Linux
```

### 規範

- 類型和描述使用小寫
- 第一行控制在 72 個字元以內
- 使用祈使語態（"add" 而不是 "added" 或 "adds"）
- 適用時在頁尾引用 issue

## 拉取請求流程

1. 將您的功能分支**推送**到您的 Fork：

   ```bash
   git push origin feat/my-feature
   ```

2. 在 GitHub 上針對 `main` 分支**打開 Pull Request**。
3. **確保 CI 通過** —— 工作流程執行：
   - `cargo check` 和 `cargo clippy -D warnings`
   - `cargo test`
   - `cargo bench --bench crop_bench`
   - 在 macOS、Windows 和 Linux 上執行
4. 向維護者**請求審查**。
5. **處理回饋** —— 使用補充提交更新您的分支。

## 發行流程

發行由維護者管理：

1. 更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本號。
2. 提交並打標籤：

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. `.github/workflows/release.yml` 工作流程自動：
   - 建置 macOS（ARM + Intel）、Windows 和 Linux 安裝程式
   - 發行 GitHub Release
   - 更新 Homebrew cask（僅限非預先發行版本）

### 測試版發行

使用預先發行 SemVer 版本打標籤：

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

發行工作流程將這些標記為 GitHub 預先發行，並將更新清單複製到 `beta` 分支。

## 行為準則

保持尊重、包容和建設性。以專案和使用者的最大利益為出發點。
