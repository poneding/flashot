import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tauri = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
const iconDir = path.join(root, "src-tauri/icons");
const appLogo = path.join(iconDir, "app-logo.svg");
const temporaryDir = await mkdtemp(path.join(tmpdir(), "flashot-icons-"));

try {
  const appOutput = path.join(temporaryDir, "app");
  const trayOutput = path.join(temporaryDir, "tray");
  const coloredTrayOutput = path.join(temporaryDir, "colored-tray");

  // Generate in a temporary directory: Flashot only ships desktop assets.
  generateIcons([appLogo, "--output", appOutput]);
  generateIcons([
    path.join(iconDir, "menubar-logo.svg"),
    "--output",
    trayOutput,
    "--png",
    "32",
  ]);
  generateIcons([
    path.join(iconDir, "menubar-colored-logo.svg"),
    "--output",
    coloredTrayOutput,
    "--png",
    "32",
  ]);

  for (const entry of await readdir(appOutput, { withFileTypes: true })) {
    if (entry.isFile() && /\.(png|ico|icns)$/.test(entry.name)) {
      await copyFile(path.join(appOutput, entry.name), path.join(iconDir, entry.name));
    }
  }

  await copyFile(path.join(trayOutput, "32x32.png"), path.join(iconDir, "menubar-logo.png"));
  await copyFile(path.join(coloredTrayOutput, "32x32.png"), path.join(iconDir, "menubar-colored-logo.png"));
  await copyFile(appLogo, path.join(root, "public/app-logo.svg"));
  await copyFile(appLogo, path.join(root, "docs/public/app-logo.svg"));

  console.log("Updated desktop icons, menu bar icons, and app / documentation logos.");
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}

function generateIcons(args) {
  execFileSync(process.execPath, [tauri, "icon", ...args], {
    cwd: root,
    stdio: "inherit",
  });
}
