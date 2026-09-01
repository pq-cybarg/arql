import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleWeb } from "../../scripts/bundle-web.mjs";

test("Pages bundle is a single module with no wallets.js or chain.js imports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arql-bundle-"));
  const out = join(dir, "app.js");
  try {
    bundleWeb(out);
    const src = readFileSync(out, "utf8");
    assert.doesNotMatch(src, /from "\.\/wallets\.js"/);
    assert.doesNotMatch(src, /from "\.\/chain\.js"/);
    assert.match(src, /eip6963:requestProvider/);
    assert.match(src, /async function loadLiveInventory/);
    assert.match(src, /function currentQrlProvider/);
    assert.match(src, /const pickQrlFrom = pickQrlProvider/);
    assert.doesNotMatch(src, /^import /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
