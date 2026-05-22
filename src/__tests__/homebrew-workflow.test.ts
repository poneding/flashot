import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const homebrewWorkflowPath = resolve(__dirname, "../../.github/workflows/homebrew.yml");
const releaseWorkflowPath = resolve(__dirname, "../../.github/workflows/release.yml");

describe("Homebrew tap workflow", () => {
  it("waits for and downloads the DMGs used by the cask URL template", () => {
    const workflow = readFileSync(homebrewWorkflowPath, "utf8");

    expect(workflow).toContain('AARCH64_ASSET="Flashot_${VERSION}_aarch64.dmg"');
    expect(workflow).toContain('X64_ASSET="Flashot_${VERSION}_x64.dmg"');
    expect(workflow).toContain('--pattern "$AARCH64_ASSET"');
    expect(workflow).toContain('--pattern "$X64_ASSET"');
    expect(workflow).not.toContain("macos-aarch64.dmg");
    expect(workflow).not.toContain("macos-x64.dmg");
  });

  it("updates the master branch of the dedicated Homebrew tap", () => {
    const workflow = readFileSync(homebrewWorkflowPath, "utf8");

    expect(workflow).toContain("repository: poneding/homebrew-flashot");
    expect(workflow).toContain("token: ${{ secrets.HOMEBREW_TAP_TOKEN }}");
    expect(workflow).toContain("ref: master");
    expect(workflow).toContain("path: tap");
  });

  it("keeps release asset names aligned with the cask URL template", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain('releaseAssetNamePattern: "[name]_[version]_[arch][ext]"');
  });
});
