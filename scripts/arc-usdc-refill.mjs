#!/usr/bin/env node
/**
 * Automated Arc Testnet USDC via Circle's developer faucet API
 * (not the recaptcha page). POST /v1/faucet/drips every ~2h 5m.
 *
 * Local env (not in git): CIRCLE_API_KEY, ARC_FAUCET_ADDRESS
 * Docs: https://developers.circle.com/api-reference/wallets/programmable-wallets/request-testnet-tokens
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INTERVAL_MS = (2 * 60 + 5) * 60 * 1000;
const API = "https://api.circle.com/v1/faucet/drips";

function loadEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i);
      if (process.env[k] == null) process.env[k] = t.slice(i + 1).replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function drip() {
  const key = process.env.CIRCLE_API_KEY;
  const addr = process.env.ARC_FAUCET_ADDRESS || process.env.ARC_ADDRESS;
  if (!key) throw new Error("CIRCLE_API_KEY is not set");
  if (!addr) throw new Error("ARC_FAUCET_ADDRESS is not set");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address: addr,
      blockchain: "ARC-TESTNET",
      usdc: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const rec = { at: new Date().toISOString(), status: res.status, ok: res.ok, address: addr, body };
  if (!res.ok) {
    console.error("drip failed", rec.status, rec.body);
    return rec;
  }
  console.log("drip ok", rec.status, rec.body);
  return rec;
}

loadEnv();
const once = process.argv.includes("--once");
console.log("Circle API faucet loop", once ? "once" : `every ${INTERVAL_MS / 60000} min`, "ARC-TESTNET USDC");
await drip();
if (once) process.exit(0);
for (;;) {
  console.log("sleep until", new Date(Date.now() + INTERVAL_MS).toISOString());
  await sleep(INTERVAL_MS);
  await drip();
}
