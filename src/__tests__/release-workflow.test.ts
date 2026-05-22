import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseWorkflowPath = resolve(__dirname, "../../.github/workflows/release.yml");
const ciWorkflowPath = resolve(__dirname, "../../.github/workflows/ci.yml");
const readmePath = resolve(__dirname, "../../README.md");

describe("release workflow", () => {
  it("keeps branch CI focused on checks instead of packaging installers", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");

    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("cargo check --all-targets");
    expect(workflow).toContain("cargo clippy --all-targets -- -D warnings");
    expect(workflow).not.toContain("tauri-apps/tauri-action");
    expect(workflow).not.toContain("uploadWorkflowArtifacts");
    expect(workflow).not.toContain("Build Tauri package");
  });

  it("publishes GitHub Releases from semantic version tags", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("name: Release");
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('"v*.*.*"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: write");
  });

  it("validates the tag against package, Tauri, and Cargo versions", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("Validate release tag");
    expect(workflow).toContain("package.json");
    expect(workflow).toContain("src-tauri/tauri.conf.json");
    expect(workflow).toContain("src-tauri/Cargo.toml");
  });

  it("builds release installers for supported desktop targets", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("macos-aarch64");
    expect(workflow).toContain("macos-x86_64");
    expect(workflow).toContain("windows-x86_64");
    expect(workflow).toContain("linux-x86_64");
    expect(workflow).toContain("tauri-apps/tauri-action@v0");
  });

  it("keeps tauri-action release inputs attached to the build step", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain(
      [
        "      - name: Build and publish GitHub Release assets",
        "        uses: tauri-apps/tauri-action@v0",
        "        env:",
        "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
        "          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
        "          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
        "        with:",
        "          tagName: ${{ env.RELEASE_TAG }}",
      ].join("\n"),
    );
  });

  it("updates the Homebrew tap after release assets are published", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("update-homebrew:");
    expect(workflow).toContain("name: Update Homebrew Cask");
    expect(workflow).toContain("needs: release");
    expect(workflow).not.toContain("if: ${{ !fromJSON(env.RELEASE_DRAFT)");
    expect(workflow).toContain(
      "if: ${{ !inputs.draft && !inputs.prerelease && !contains(github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name, '-') }}",
    );
    expect(workflow).toContain("repository: poneding/homebrew-flashot");
    expect(workflow).toContain("token: ${{ secrets.HOMEBREW_TAP_TOKEN }}");
    expect(workflow).toContain('AARCH64_ASSET="Flashot_${VERSION}_aarch64.dmg"');
    expect(workflow).toContain('X64_ASSET="Flashot_${VERSION}_x64.dmg"');
  });

  it("generates structured release notes with git-cliff", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("orhun/git-cliff-action@v4");
    expect(workflow).toContain("--latest --strip header");
    expect(workflow).toContain("needs.changelog.outputs.body");
  });

  it("derives prerelease status from the release tag for tag and manual runs", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain(
      "contains(github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name, '-')",
    );
    expect(workflow).toContain("inputs.prerelease");
  });

  it("does not publish the internal Rust crate to Cargo", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");
    const readme = readFileSync(readmePath, "utf8");

    expect(workflow).not.toContain("cargo publish");
    expect(workflow).not.toContain("CARGO_REGISTRY_TOKEN");
    expect(readme).toContain("is not published to crates.io");
  });

  it("documents the maintainer release trigger", () => {
    const readme = readFileSync(readmePath, "utf8");

    expect(readme).toContain("git tag v0.1.0");
    expect(readme).toContain("git push origin v0.1.0");
    expect(readme).toContain(".github/workflows/release.yml");
  });
});
