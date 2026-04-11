/**
 * Build script: bundles the TypeScript plugin into a single bin/plugin.js
 * using esbuild. Run with --watch for development hot-reload.
 */

import * as esbuild from "esbuild";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");
const watch = process.argv.includes("--watch");

mkdirSync(resolve(root, "bin"), { recursive: true });

const ctx = await esbuild.context({
  entryPoints: [resolve(root, "src/plugin.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: resolve(root, "bin/plugin.js"),
  sourcemap: false,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("[build] watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[build] done → bin/plugin.js");
}
