import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../apps/web/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../apps/web/app.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../../scripts/web-server.mjs", import.meta.url), "utf8");

test("Pages desk asks wallets to re-announce and does not hit /api/state on github.io", () => {
  assert.match(html, /rel="icon" href="\.\/usdc\.png"/);
  assert.match(html, /id="arc-refresh"/);
  assert.match(html, /app\.js\?v=ux20/);
  assert.match(app, /from "\.\/wallets\.js"/);
  assert.match(app, /requestEip6963\(\)/);
  assert.match(app, /shouldSkipLiveApi\(location\.hostname\)/);
  assert.match(app, /walletRpcUrl\(location, cfg\.rpc\)/);
  assert.match(app, /findWallet\(evmWallets\(\), eip6963, uuid\)/);
  assert.match(server, /\/api\/qrl-rpc/);
});
