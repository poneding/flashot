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

  it("validates the tap write token before checkout", () => {
    for (const workflowPath of [homebrewWorkflowPath, releaseWorkflowPath]) {
      const workflow = readFileSync(workflowPath, "utf8");

      expect(workflow).toContain("- name: Validate Homebrew tap token");
      expect(workflow).toContain("HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}");
      expect(workflow).toContain("::error::Missing HOMEBREW_TAP_TOKEN");
      expect(workflow.indexOf("Validate Homebrew tap token")).toBeLessThan(
        workflow.indexOf("Checkout Homebrew tap"),
      );
    }
  });

  it("keeps release asset names aligned with the cask URL template", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain('assetNamePattern: "[name]_[version]_[arch][ext]"');
  });

  it("updates only the cask version and sha256 block", () => {
    for (const workflowPath of [homebrewWorkflowPath, releaseWorkflowPath]) {
      const workflow = readFileSync(workflowPath, "utf8");

      expect(workflow).toContain("ruby <<'RUBY'");
      expect(workflow).toContain('content.sub!(/^  version ".*"$/, %(  version "#{version}"))');
      expect(workflow).toContain('^  sha256 arm:\\s+".*",\\n\\s+intel:\\s+".*"$');
      expect(workflow).not.toContain('s/arm:   ".*"/arm:');
      expect(workflow).not.toContain('s/intel: ".*"/intel:');
    }
  });
});
