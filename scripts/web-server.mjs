#!/usr/bin/env node
import http from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getWeb3, loadMeta, loadAbis, send, units, toQ } from "../live/operator.mjs";
import { qrlRpc } from "../live/rpc.mjs";
import { faucetCheck, faucetCommit, faucetStatus } from "./faucet-lib.mjs";
import { loadReports } from "../live/reports-read.mjs";
import { watchOnChainCode } from "../live/code-watch.mjs";
import { isSanctioned, setSanctioned, requireClear } from "./sanctions-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../apps/web");
const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.WEB_PORT || 7470);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function sendJson(res, obj, code = 200) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function qrlCall(to, data) {
  return qrlRpc("qrl_call", [{ to: toQ(to), data }, "latest"]);
}

async function state() {
  const live = loadMeta();
  const { acc } = getWeb3();
  const to = live.usdcQ || live.usdc;
  const holderHex = String(live.deployerQ || live.deployer).replace(/^Q/i, "").replace(/^0x/i, "").toLowerCase();
  const holder = holderHex.padStart(64, "0");
  const dp = live.decimals || 6;
  const [supply, held, minter, qrlBal, block] = await Promise.all([
    qrlCall(to, "0x18160ddd"),
    qrlCall(to, "0x70a08231" + holder),
    qrlCall(to, "0x07546172"), // minter()
    qrlRpc("qrl_getBalance", [toQ(acc.address), "latest"]),
    qrlRpc("qrl_blockNumber", []),
  ]);
  let allowance = "0";
  if (live.bridgeQ) {
    const spender = String(live.bridgeQ).replace(/^Q/i, "").replace(/^0x/i, "").toLowerCase().padStart(64, "0");
    allowance = await qrlCall(to, "0xdd62ed3e" + holder + spender);
  }
  const addrWord = (hex) => {
    const h = String(hex || "").replace(/^0x/i, "");
    if (h.length < 40) return "";
    return "Q" + h.slice(-40);
  };
  return {
    standard: "QRC-20",
    network: live.network,
    rpc: live.rpc,
    contract: toQ(to),
    holder: toQ(acc.address),
    minter: addrWord(minter),
    bridge: live.bridgeQ || null,
    symbol: live.symbol || "USDC",
    decimals: dp,
    total: Number(BigInt(supply)) / 10 ** dp,
    held: Number(BigInt(held)) / 10 ** dp,
    allowance: Number(BigInt(allowance)) / 10 ** dp,
    qrl: Number(BigInt(qrlBal)) / 1e18,
    block: Number(BigInt(block)),
    deployTx: live.deployTx,
    mintTx: live.mintTx,
    bridgeTx: live.bridgeTx,
    explorerToken: live.explorerToken,
    explorerBridge: live.explorerBridge,
    sealedBridge: live.sealedBridge || null,
    explorerSealedBridge: live.explorerSealedBridge || null,
    bridgeMintSealed: !!live.bridgeMintSealed,
    faucet: faucetStatus(),
    reportBoard: live.reportBoardQ || null,
    reportMinFee: live.reportMinFee || "10000000000000000",
    reports: live.reportBoardQ ? await loadReports(live.reportBoardQ) : { count: 0, items: [] },
    codeWatch: await watchOnChainCode(live),
  };
}

function isLoopback(req) {
  const ip = String(req.socket?.remoteAddress || "");
  return ip === "127.0.0.1" || ip === "::1" || ip.endsWith("127.0.0.1");
}

async function encodeAndSend(action, body, req) {
  const live = loadMeta();
  const abis = loadAbis();
  const { web3, acc } = getWeb3();
  const token = new web3.qrl.Contract(abis.usdc.abi, live.usdcQ);
  const bridge = live.bridgeQ && abis.bridge ? new web3.qrl.Contract(abis.bridge.abi, live.bridgeQ) : null;
  const toAddr = body.to ? toQ(body.to) : acc.address;
  const amt = body.amount != null && body.amount !== "" ? units(body.amount) : 0n;
  if (action === "sanctionCheck") {
    return { account: toAddr, blocked: isSanctioned(toAddr) };
  }
  if (action === "sanctionSet") {
    if (!isLoopback(req)) throw new Error("flag/clear only from the operator desk");
    const op = toQ(acc.address);
    const actor = toQ(body.actor || "");
    if (actor && actor !== op) throw new Error("only the operator account can flag or clear");
    if (!body.on && body.confirm !== "clear") throw new Error("clear requires confirm=clear");
    return setSanctioned(toAddr, !!body.on);
  }
  if (["faucet", "mint", "receiveMint", "transfer"].includes(action)) {
    requireClear(toAddr);
    if (body.from) requireClear(body.from);
  }

  if (action === "transfer") {
    if (amt <= 0n) throw new Error("amount");
    return send(live.usdcQ, token.methods.transfer(toAddr, amt).encodeABI());
  }
  if (action === "approve") {
    const spender = toQ(body.spender || live.bridgeQ);
    return send(live.usdcQ, token.methods.approve(spender, amt).encodeABI(), 80000n);
  }
  if (action === "faucet") {
    const rail = body.rail === "arc" ? "arc" : "qrl";
    const { st, key, amount } = faucetCheck(toAddr);
    if (rail === "arc") {
      throw new Error("Arc faucet inventory is filled on this machine via npm run faucet:arc-refill; sending is not wired until an Arc operator account is set");
    }
    const v1 = new web3.qrl.Contract(
      [{ type: "function", name: "mint", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "amount" }], outputs: [] }],
      live.bridgeQ,
    );
    const sent = await send(live.bridgeQ, v1.methods.mint(toAddr, units(String(amount))).encodeABI());
    const rec = faucetCommit(st, key, amount);
    return { ...sent, faucet: rec, rail };
  }
  if (action === "mint") {
    if (live.bridgeMintSealed) {
      throw new Error("unsealed mint removed; pin expectedArcSeal and use receiveMint");
    }
    const v1 = new web3.qrl.Contract(
      [{ type: "function", name: "mint", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "amount" }], outputs: [] }],
      live.bridgeQ,
    );
    return send(live.bridgeQ, v1.methods.mint(toAddr, amt).encodeABI());
  }
  if (action === "burn") {
    if (amt <= 0n) throw new Error("amount");
    return send(live.usdcQ, token.methods.burn(amt).encodeABI());
  }
  if (action === "depositForBurn") {
    if (!bridge) throw new Error("bridge not deployed");
    if (amt <= 0n) throw new Error("amount");
    const destDomain = Number(body.destinationDomain || 26);
    const mintTo = toQ(body.mintRecipient || acc.address);
    return send(
      live.bridgeQ,
      bridge.methods.depositForBurn(amt, destDomain, mintTo).encodeABI(),
      250000n,
    );
  }
  if (action === "receiveMint") {
    if (!bridge) throw new Error("bridge not deployed");
    const nonce = body.nonce && String(body.nonce).startsWith("0x")
      ? body.nonce
      : web3.utils.keccak256(String(body.nonce || Date.now()));
    if (live.bridgeMintSealed) {
      const seal = String(body.arcSeal || "").trim();
      if (!seal || seal === "0x" + "00".repeat(32)) throw new Error("arcSeal required (pinned Arc code seal)");
      return send(
        live.bridgeQ,
        bridge.methods.receiveMint(toAddr, amt, nonce, seal).encodeABI(),
        250000n,
      );
    }
    const v1 = new web3.qrl.Contract(
      [{
        type: "function",
        name: "receiveMint",
        inputs: [
          { type: "address", name: "to" },
          { type: "uint256", name: "amount" },
          { type: "bytes32", name: "nonce" },
        ],
        outputs: [],
      }],
      live.bridgeQ,
    );
    return send(live.bridgeQ, v1.methods.receiveMint(toAddr, amt, nonce).encodeABI(), 250000n);
  }
  throw new Error("unknown action");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  try {
    if (url.pathname === "/live.json" || url.pathname === "/deployments.json") {
      const p = join(repo, "deployments/qrl-testnet.json");
      return sendJson(res, existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
    }
    if (url.pathname === "/qrl/usdc" || url.pathname === "/api/state") {
      return sendJson(res, await state());
    }
    if (url.pathname === "/api/qrl-rpc") {
      if (req.method !== "POST") {
        res.writeHead(405, { "access-control-allow-origin": "*" });
        return res.end("POST only");
      }
      const upstream = process.env.QRL_RPC || "https://qrlwallet.com/api/qrl-rpc/testnet";
      const r = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await readRaw(req),
      });
      const text = await r.text();
      res.writeHead(r.status, {
        "content-type": r.headers.get("content-type") || "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store",
      });
      return res.end(text);
    }
    if (req.method === "POST" && url.pathname === "/api/qrl") {
      const body = await readBody(req);
      const action = body.action;
      const result = await encodeAndSend(action, body, req);
      let snap = null;
      try {
        snap = await state();
      } catch {
        /* receipt may land next block */
      }
      return sendJson(res, { ok: true, action, ...result, state: snap });
    }
  } catch (err) {
    return sendJson(res, { error: String(err.message || err) }, 400);
  }

  let pathName = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(root, pathName);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
});

server.listen(PORT, () => console.log(`ARQL desk http://127.0.0.1:${PORT}`));
