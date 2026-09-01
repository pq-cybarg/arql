#!/usr/bin/env node
/**
 * Reminder loop for Circle's public Arc Testnet faucet.
 * https://faucet.circle.com/ — 20 USDC per address every 2 hours (reCAPTCHA).
 * Opens the page; you complete the claim. No unofficial drip API.
 */
import { spawn } from "node:child_process";

const INTERVAL_MS = (2 * 60 + 5) * 60 * 1000;
const CLAIM = 20;
const URL = "https://faucet.circle.com/";
const addr = process.env.ARC_FAUCET_ADDRESS || process.env.ARC_ADDRESS || "";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}

async function once() {
  console.log(new Date().toISOString(), "Circle faucet:", CLAIM, "USDC on Arc Testnet");
  if (addr) console.log("use address", addr);
  console.log("pick Arc Testnet, USDC, Send 20 USDC (one claim per address / 2 hours)");
  openBrowser(URL);
}

console.log("Arc USDC refill via", URL);
await once();
for (;;) {
  console.log("next open after", new Date(Date.now() + INTERVAL_MS).toISOString());
  await sleep(INTERVAL_MS);
  await once();
}
