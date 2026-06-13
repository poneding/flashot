# 贡献指南

欢迎贡献！无论是 bug 修复、新功能还是文档改进，您的帮助都会让 Flashot 变得更好。

## 开始

1. 在 GitHub 上 **Fork** 本仓库。
2. **克隆** 您的 Fork：

   ```bash
   git clone https://github.com/your-username/flashot.git
   cd flashot
   ```

3. **搭建**开发环境 —— 参见[环境搭建](/zh-CN/development/setup)指南。
4. **创建功能分支**：

   ```bash
   git checkout -b feat/my-feature
   ```

## 开发工作流

1. 进行修改。
2. 运行测试：

   ```bash
   pnpm test              # 前端测试
   cd src-tauri && cargo test  # Rust 测试
   ```

3. 运行代码检查：

   ```bash
   pnpm lint                     # TypeScript
   cd src-tauri && cargo clippy  # Rust
   ```

4. 验证构建：

   ```bash
   pnpm tauri build
   ```

## 提交规范

Flashot 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>: <description>

[optional body]
[optional footer]
```

### 类型

| 类型 | 用途 |
|------|-------|
| `feat` | 面向用户的新功能 |
| `fix` | 面向用户的 bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码风格（格式化等） |
| `refactor` | 不影响功能的重构 |
| `perf` | 性能改进 |
| `test` | 添加或更新测试 |
| `chore` | 维护工作（依赖、构建配置、CI） |
| `ci` | CI/CD 配置变更 |

### 示例

```
feat: add color picker to crosshair cursor
fix: resolve memory leak in session cleanup
refactor: extract window detection logic to separate module
docs: update installation guide for Linux
```

### 规范

- 类型和描述使用小写
- 第一行控制在 72 个字符以内
- 使用祈使语态（"add" 而不是 "added" 或 "adds"）
- 适用时在页脚引用 issue

## 拉取请求流程

1. 将您的功能分支**推送**到您的 Fork：

   ```bash
   git push origin feat/my-feature
   ```

2. 在 GitHub 上针对 `main` 分支**打开 Pull Request**。
3. **确保 CI 通过** —— 工作流运行：
   - `cargo check` 和 `cargo clippy -D warnings`
   - `cargo test`
   - `cargo bench --bench crop_bench`
   - 在 macOS、Windows 和 Linux 上运行
4. 向维护者**请求审查**。
5. **处理反馈** —— 使用补充提交更新您的分支。

## 发布流程

发布由维护者管理：

1. 更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号。
2. 提交并打标签：

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. `.github/workflows/release.yml` 工作流自动：
   - 构建 macOS（ARM + Intel）、Windows 和 Linux 安装程序
   - 发布 GitHub Release
   - 更新 Homebrew cask（仅限非预发布版本）

### 测试版发布

使用预发布 SemVer 版本打标签：

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

发布工作流将这些标记为 GitHub 预发布，并将更新清单复制到 `beta` 分支。

## 行为准则

保持尊重、包容和建设性。以项目和用户的最大利益为出发点。
