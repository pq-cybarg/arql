#!/usr/bin/env node
/**
 * Local refill loop for Arc Testnet USDC.
 * Circle's public faucet pays 20 USDC per address every 2 hours (captcha).
 * This script waits that interval and either hits an API token if set,
 * or prints the claim URL so the operator can click through.
 */
const INTERVAL_MS = (2 * 60 + 5) * 60 * 1000;
const CLAIM = 20;
const URL = "https://faucet.circle.com";
const addr = process.env.ARC_FAUCET_ADDRESS || process.env.ARC_ADDRESS || "";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryApi(address) {
  const token = process.env.CIRCLE_FAUCET_TOKEN;
  if (!token) return { ok: false, reason: "no CIRCLE_FAUCET_TOKEN" };
  const res = await fetch("https://api.circle.com/v1/faucet/drips", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      address,
      blockchain: "ARC-TESTNET",
      native: false,
      usdc: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function once() {
  if (!addr) {
    console.log("set ARC_FAUCET_ADDRESS to the Arc Testnet account that should receive Circle USDC");
    return;
  }
  console.log(new Date().toISOString(), "claim up to", CLAIM, "USDC on Arc Testnet for", addr);
  const api = await tryApi(addr);
  if (api.ok) {
    console.log("circle api", api.status, api.body);
    return;
  }
  console.log("open", URL, "(Arc Testnet, 20 USDC / 2 hours). api:", api.reason || api.status, api.body || "");
}

console.log("Arc USDC refill. interval", INTERVAL_MS / 60000, "min. official claim", CLAIM, "USDC.");
await once();
for (;;) {
  console.log("next claim after", new Date(Date.now() + INTERVAL_MS).toISOString());
  await sleep(INTERVAL_MS);
  await once();
}
