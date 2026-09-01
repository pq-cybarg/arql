#!/usr/bin/env node
/** Collapse apps/web ESM imports into one module so GitHub Pages cannot 503 wallets.js/chain.js. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../apps/web");

function stripExports(src) {
  return src
    .replace(/^export async function /gm, "async function ")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export \{[\s\S]*?\};?\n?/gm, "");
}

function stripImports(src) {
  return src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];\s*\n?/gm, "");
}

export function bundleWeb(outFile) {
  if (!outFile) throw new Error("bundle-web: outfile required");
  const srcApp = join(root, "app.js");
  if (outFile === srcApp && process.env.PAGES_BUNDLE !== "1") {
    throw new Error("refusing to overwrite apps/web/app.js (set PAGES_BUNDLE=1 in CI)");
  }
  const wallets = stripExports(readFileSync(join(root, "wallets.js"), "utf8"));
  const chain = stripExports(readFileSync(join(root, "chain.js"), "utf8"));
  const app = stripImports(readFileSync(srcApp, "utf8"));
  if (app.includes('from "./wallets.js"') || app.includes('from "./chain.js"')) {
    throw new Error("bundle-web: import strip failed");
  }
  const body = [
    "/* generated: inlined wallets.js + chain.js so Pages serves one module */",
    wallets.trim(),
    "const pickQrlFrom = pickQrlProvider;",
    chain.trim(),
    app.trim(),
    "",
  ].join("\n\n");
  writeFileSync(outFile, body);
  return outFile;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dest = process.argv[2];
  if (!dest) {
    console.error("usage: node scripts/bundle-web.mjs <outfile>");
    process.exit(1);
  }
  bundleWeb(dest);
  console.log("bundled", dest);
}
