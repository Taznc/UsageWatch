/**
 * Install script: builds the plugin and copies it into the Stream Deck
 * plugins directory. The Stream Deck software must be restarted after
 * installation for changes to take effect.
 *
 * Usage:
 *   npm run install-plugin
 */

import { execFileSync } from "child_process";
import { cpSync, mkdirSync, rmSync, existsSync } from "fs";
import { homedir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");
const pluginId = "com.usagewatch.sdPlugin";

const sdPluginsDir = resolve(
  homedir(),
  "Library/Application Support/com.elgato.StreamDeck/Plugins"
);
const destDir = resolve(sdPluginsDir, pluginId);

// Build first
console.log("[install] Building plugin...");
execFileSync("node", ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });

// Remove old install if present
if (existsSync(destDir)) {
  console.log(`[install] Removing old plugin at ${destDir}`);
  rmSync(destDir, { recursive: true, force: true });
}

mkdirSync(destDir, { recursive: true });

// Copy built bundle
cpSync(resolve(root, "bin"), resolve(destDir, "bin"), { recursive: true });

// Copy manifest
cpSync(resolve(root, "manifest.json"), resolve(destDir, "manifest.json"));

// Copy images if they exist
const imgsDir = resolve(root, "imgs");
if (existsSync(imgsDir)) {
  cpSync(imgsDir, resolve(destDir, "imgs"), { recursive: true });
}

console.log(`\n[install] Plugin installed to:\n  ${destDir}`);
console.log(
  "\nRestart the Stream Deck software (or quit and reopen) to load the plugin."
);
