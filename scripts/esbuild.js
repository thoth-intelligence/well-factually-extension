// esbuild.js — bundle + minify the extension for release distribution.
//
// Bundles four entry points from chrome-extension/ → build/chrome-extension/:
//
//   background.js  — ES module service worker. Bundles all imports
//                    (consensus.js, format_guard.js, vertex.js, gemini-
//                    studio.js, prompts.js) into one self-contained ESM
//                    file. Manifest declares `"type": "module"`.
//   content.js     — Classic IIFE content script. No imports — bundling
//                    just runs the minifier + comment stripper.
//   affiliate.js   — Classic IIFE content script (loaded before
//                    content.js per manifest). Same treatment as content.
//   options.js     — Classic script loaded from options.html. Same.
//
// Why bundle + minify, NOT obfuscate:
// Chrome Web Store explicitly prohibits obfuscation that prevents human
// review (https://developer.chrome.com/docs/webstore/program-policies/
// code-readability). Esbuild's default minification (mangling, dead-code
// elimination, comment stripping) is fine and matches industry practice.
// Control-flow flattening, string-array encoding, or eval-based obfusc-
// ators would trip the policy.
//
// All other extension assets (manifest.json, options.html, sidebar.css,
// LICENSE, README.md) are copied verbatim by scripts/build.sh. This file
// only produces the JS bundle output.

import { build } from "esbuild";
import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "chrome-extension");
const OUT = path.join(ROOT, "build", "chrome-extension");

// Read version from manifest so the build banner reflects the shipped
// version. The build.sh zip-naming step also reads this.
const manifest = JSON.parse(await readFile(path.join(SRC, "manifest.json"), "utf8"));
const VERSION = manifest.version;

// Wipe stale build output so removed source files don't ghost-ship.
if (existsSync(path.join(ROOT, "build"))) {
  await rm(path.join(ROOT, "build"), { recursive: true });
}
await mkdir(OUT, { recursive: true });

const COMMON = {
  bundle: true,
  minify: true,
  legalComments: "none",
  drop: ["debugger"],
  treeShaking: true,
  // chrome120 = MV3 target, supports modern syntax/APIs without polyfills.
  target: "chrome120",
  // Don't emit source maps in the shipped bundle. Optional `--dev` flag
  // could turn these back on for local debugging.
  sourcemap: false,
  // Banner inserts a single comment per file so a Chrome Web Store
  // reviewer can see what they're looking at without reading the
  // mangled body. legalComments:"none" still strips author/license
  // comments inside dependency graphs.
  banner: { js: `/* Well, Factually extension v${VERSION} — minified bundle. Source: github.com/zangiku/well-factually-extension */` }
};

console.log(`esbuild: bundling v${VERSION} → ${path.relative(ROOT, OUT)}`);

await Promise.all([
  // Service worker — ESM. Bundles all background.js's imports into one file.
  build({
    ...COMMON,
    entryPoints: [path.join(SRC, "background.js")],
    outfile: path.join(OUT, "background.js"),
    format: "esm",
  }),
  // Content script — classic IIFE. Wrapping the bundle output in an IIFE
  // matches the current source shape and avoids accidentally leaking
  // top-level identifiers into the isolated world.
  build({
    ...COMMON,
    entryPoints: [path.join(SRC, "content.js")],
    outfile: path.join(OUT, "content.js"),
    format: "iife",
  }),
  // Affiliate helper — classic IIFE, already self-wrapped in source.
  build({
    ...COMMON,
    entryPoints: [path.join(SRC, "affiliate.js")],
    outfile: path.join(OUT, "affiliate.js"),
    format: "iife",
  }),
  // Options page controller — classic script loaded by options.html.
  // Bundled to iife to avoid name collisions if options.html ever loads
  // additional scripts.
  build({
    ...COMMON,
    entryPoints: [path.join(SRC, "options.js")],
    outfile: path.join(OUT, "options.js"),
    format: "iife",
  }),
]);

// Copy non-JS extension assets that the runtime expects at the same
// relative paths. Anything not in this list won't ship — keep deliberate.
const ASSETS = [
  "manifest.json",
  "options.html",
  "sidebar.css",
  "README.md",
];
for (const file of ASSETS) {
  const src = path.join(SRC, file);
  const dst = path.join(OUT, file);
  if (existsSync(src)) {
    await copyFile(src, dst);
    console.log(`  copy: ${file}`);
  }
}

console.log(`esbuild: done. Output at ${path.relative(ROOT, OUT)}`);
