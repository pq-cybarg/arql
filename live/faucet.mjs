#!/usr/bin/env node
import { loadOrCreateWallet } from "./wallet.mjs";
import { FAUCET_CLAIM, EXPLORER, toQ, qrlRpc } from "./rpc.mjs";

const wallet = loadOrCreateWallet();
const address = toQ(wallet.address);
console.log("claiming faucet for", address);

const res = await fetch(FAUCET_CLAIM, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address, turnstileToken: process.env.TURNSTILE_TOKEN }),
});
const data = await res.json().catch(() => ({}));
console.log("http", res.status, data);

if (!res.ok) {
  console.log("open", "https://zondscan.com/faucet");
  console.log("paste", address);
  if (res.status === 400 || res.status === 403) {
    console.log("Turnstile is on. After solving in the browser, re-run: node live/faucet.mjs");
  }
}

try {
  const bal = await qrlRpc("qrl_getBalance", [address, "latest"]);
  console.log("qrl_getBalance", bal, "(", Number(BigInt(bal)) / 1e18, "QRL )");
} catch (err) {
  console.log("balance lookup failed", err.message);
}
console.log("explorer", `${EXPLORER}/address/${address}`);
