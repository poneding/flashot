# Contributing

Contributions are welcome! Whether it's a bug fix, a new feature, or documentation improvement, your help makes Flashot better.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork:

   ```bash
   git clone https://github.com/your-username/flashot.git
   cd flashot
   ```

3. **Set up** your development environment — see the [Setup guide](/development/setup).
4. **Create a feature branch**:

   ```bash
   git checkout -b feat/my-feature
   ```

## Development Workflow

1. Make your changes.
2. Run tests:

   ```bash
   pnpm test              # Frontend tests
   cd src-tauri && cargo test  # Rust tests
   ```

3. Run linting:

   ```bash
   pnpm lint                     # TypeScript
   cd src-tauri && cargo clippy  # Rust
   ```

4. Verify the build:

   ```bash
   pnpm tauri build
   ```

## Commit Convention

Flashot follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
[optional footer]
```

### Types

| Type | Usage |
|------|-------|
| `feat` | New feature for the user |
| `fix` | Bug fix for the user |
| `docs` | Documentation changes |
| `style` | Code style (formatting, etc.) |
| `refactor` | Refactoring without functionality change |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |
| `chore` | Maintenance (dependencies, build config, CI) |
| `ci` | CI/CD configuration changes |

### Examples

```
feat: add color picker to crosshair cursor
fix: resolve memory leak in session cleanup
refactor: extract window detection logic to separate module
docs: update installation guide for Linux
```

### Guidelines

- Use lowercase for type and description
- Keep the first line under 72 characters
- Use imperative mood ("add" not "added" or "adds")
- Reference issues in the footer when applicable

## Pull Request Process

1. **Push** your feature branch to your fork:

   ```bash
   git push origin feat/my-feature
   ```

2. **Open a Pull Request** on GitHub against the `main` branch.
3. **Ensure CI passes** — the workflow runs:
   - `cargo check` and `cargo clippy -D warnings`
   - `cargo test`
   - `cargo bench --bench crop_bench`
   - On macOS, Windows, and Linux
4. **Request a review** from the maintainers.
5. **Address feedback** — update your branch with additional commits.

## Release Process

Releases are managed by maintainers:

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Commit and tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The `.github/workflows/release.yml` workflow automatically:
   - Builds macOS (ARM + Intel), Windows, and Linux installers
   - Publishes a GitHub Release
   - Updates the Homebrew cask (for non-prerelease releases)

### Beta Releases

Tag with a prerelease SemVer version:

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

The release workflow marks these as GitHub prereleases and copies the updater manifest to the `beta` branch.

## Code of Conduct

Be respectful, inclusive, and constructive. Focus on what's best for the project and its users.
