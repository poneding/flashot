import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Tauri capabilities", () => {
  it("grants IPC permissions to overlay and settings windows", () => {
    const capabilityPath = resolve(__dirname, "../../src-tauri/capabilities/default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as { windows: string[] };

    expect(capability.windows).toContain("overlay-*");
    expect(capability.windows).toContain("settings");
  });
});
