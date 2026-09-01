#!/usr/bin/env node
/** Public QRVM snapshot for GitHub Pages. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qrlRpc, toQ } from "./rpc.mjs";
import { loadReports } from "./reports-read.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "apps/web/config.json"), "utf8"));
const token = toQ(cfg.usdcQ);
const holder = toQ(cfg.holderQ);
const pad = (q) => q.replace(/^Q/i, "").replace(/^0x/i, "").toLowerCase().padStart(64, "0");
const call = (data) => qrlRpc("qrl_call", [{ to: token, data }, "latest"]);

const [supply, held, minter, qrlBal, block] = await Promise.all([
  call("0x18160ddd"),
  call("0x70a08231" + pad(holder)),
  call("0x07546172"),
  qrlRpc("qrl_getBalance", [holder, "latest"]),
  qrlRpc("qrl_blockNumber", []),
]);
let allowance = "0x0";
if (cfg.bridgeQ) {
  allowance = await call("0xdd62ed3e" + pad(holder) + pad(cfg.bridgeQ));
}
const dp = cfg.decimals || 6;
const state = {
  standard: "QRC-20",
  network: cfg.network,
  contract: token,
  holder,
  minter: "Q" + String(minter).replace(/^0x/i, "").slice(-40),
  bridge: cfg.bridgeQ,
  symbol: cfg.symbol,
  decimals: dp,
  total: Number(BigInt(supply)) / 10 ** dp,
  held: Number(BigInt(held)) / 10 ** dp,
  allowance: Number(BigInt(allowance)) / 10 ** dp,
  qrl: Number(BigInt(qrlBal)) / 1e18,
  block: Number(BigInt(block)),
  deployTx: cfg.deployTx,
  mintTx: cfg.mintTx,
  bridgeTx: cfg.bridgeTx,
  explorerToken: `${cfg.explorer}/address/${token}`,
  explorerBridge: `${cfg.explorer}/address/${cfg.bridgeQ}`,
  sealedBridge: cfg.sealedBridge || null,
  reportBoard: cfg.reportBoardQ || null,
  reports: cfg.reportBoardQ ? await loadReports(cfg.reportBoardQ) : { count: 0, items: [] },
  snappedAt: new Date().toISOString(),
};
const out = path.join(root, "apps/web/state.json");
fs.writeFileSync(out, JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
