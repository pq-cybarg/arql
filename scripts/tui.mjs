#!/usr/bin/env node
/**
 * ARQL live desk (TUI). Reads QRC-20 USDC on QRL 2.0 QRVM.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { qrlRpc, toQ, to0x, EXPLORER } from "../live/rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const livePath = path.join(root, "deployments/qrl-testnet.json");
const walletPath = process.env.ARQL_WALLET;

const BALANCE_OF = "0x70a08231";
const TOTAL = "0x18160ddd";
const NAME = "0x06fdde03";
const SYMBOL = "0x95d89b41";
const DECIMALS = "0x313ce567";

function padAddr(addr) {
  return to0x(addr).slice(2).toLowerCase().padStart(64, "0");
}

function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function decodeString(hex) {
  if (!hex || hex.length < 2 + 64 + 64) return "";
  const data = hex.slice(2);
  const offset = Number(BigInt("0x" + data.slice(0, 64)));
  const len = Number(BigInt("0x" + data.slice(offset * 2, offset * 2 + 64)));
  const strHex = data.slice(offset * 2 + 64, offset * 2 + 64 + len * 2);
  return Buffer.from(strHex, "hex").toString("utf8");
}

let rpcUrl = process.env.QRL_RPC;
async function call(to, data) {
  return qrlRpc("qrl_call", [{ to: toQ(to), data }, "latest"], rpcUrl);
}

async function snapshot() {
  const live = fs.existsSync(livePath) ? JSON.parse(fs.readFileSync(livePath, "utf8")) : null;
  const wallet = walletPath && fs.existsSync(walletPath) ? JSON.parse(fs.readFileSync(walletPath, "utf8")) : null;
  if (live?.rpc) rpcUrl = live.rpc;
  const out = {
    time: new Date().toISOString(),
    live,
    wallet: wallet ? { address: wallet.address } : null,
    qrl: null,
    usdc: null,
    err: null,
  };
  try {
    const holder = live?.deployer || wallet?.address;
    if (holder) {
      const bal = await qrlRpc("qrl_getBalance", [toQ(holder), "latest"], rpcUrl);
      out.qrl = Number(decodeUint(bal)) / 1e18;
    }
    if (live?.usdc && holder) {
      const [name, symbol, decimals, supply, held] = await Promise.all([
        call(live.usdc, NAME),
        call(live.usdc, SYMBOL),
        call(live.usdc, DECIMALS),
        call(live.usdc, TOTAL),
        call(live.usdc, BALANCE_OF + padAddr(holder)),
      ]);
      const dp = Number(decodeUint(decimals));
      out.usdc = {
        name: decodeString(name) || live.name,
        symbol: decodeString(symbol) || live.symbol,
        decimals: dp,
        total: Number(decodeUint(supply)) / 10 ** dp,
        held: Number(decodeUint(held)) / 10 ** dp,
        contract: toQ(live.usdc),
      };
    }
    const bn = await qrlRpc("qrl_blockNumber", [], rpcUrl);
    out.block = Number(decodeUint(bn));
  } catch (err) {
    out.err = err.message;
  }
  return out;
}

function paint(s) {
  const lines = [];
  const gold = (t) => `\x1b[38;2;196;154;74m${t}\x1b[0m`;
  const cyan = (t) => `\x1b[38;2;31;167;160m${t}\x1b[0m`;
  const mute = (t) => `\x1b[38;2;140;127;102m${t}\x1b[0m`;
  const paper = (t) => `\x1b[38;2;243;235;216m${t}\x1b[0m`;
  lines.push(gold("ARQL  live QRVM desk"));
  lines.push(mute("QRC-20 USDC on QRL 2.0  ·  20-byte addresses  ·  ML-DSA-87"));
  lines.push("");
  lines.push(paper(`block  ${s.block ?? "—"}`.padEnd(28)) + mute(s.time));
  const shown = s.live?.deployerQ || s.wallet?.address;
  if (shown) lines.push(paper("wallet ") + cyan(toQ(shown)));
  lines.push(paper("QRL    ") + `${s.qrl == null ? "—" : s.qrl.toFixed(6)} Quanta`);
  if (s.usdc) {
    lines.push("");
    lines.push(gold("QRC-20 USDC"));
    lines.push(`  ${s.usdc.name} (${s.usdc.symbol})  decimals ${s.usdc.decimals}`);
    lines.push(`  contract  ${s.usdc.contract}`);
    lines.push(cyan(`  held      ${s.usdc.held} USDC`));
    lines.push(`  supply    ${s.usdc.total} USDC`);
    if (s.live?.explorerToken) lines.push(mute(`  ${s.live.explorerToken}`));
  } else {
    lines.push("");
    lines.push(mute("no QRC-20 USDC deployed yet — node live/deploy.mjs"));
  }
  if (s.err) lines.push("\n" + `\x1b[31m${s.err}\x1b[0m`);
  lines.push("");
  lines.push(mute("q quit  ·  r refresh  ·  explorer " + EXPLORER));
  return lines.join("\n");
}

const once = process.argv.includes("--once");
if (once) {
  const s = await snapshot();
  console.log(paint(s));
  if (!s.usdc) process.exitCode = 2;
  process.exit();
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
let timer;
async function tick() {
  const s = await snapshot();
  process.stdout.write("\x1b[2J\x1b[H" + paint(s) + "\n");
}
process.stdin.on("data", (ch) => {
  if (ch === "q" || ch === "\u0003") {
    clearInterval(timer);
    process.exit(0);
  }
  if (ch === "r") tick();
});
await tick();
timer = setInterval(tick, 8000);
