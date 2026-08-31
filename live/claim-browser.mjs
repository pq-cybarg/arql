#!/usr/bin/env node
import { createRequire } from "node:module";
import { loadOrCreateWallet } from "./wallet.mjs";
import { toQ } from "./rpc.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const wallet = loadOrCreateWallet();
const address = toQ(wallet.address);
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--new-window"],
});
const page = await browser.newPage();
await page.goto("https://zondscan.com/faucet", { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector("input", { timeout: 30000 });
await page.evaluate((addr) => {
  const el = document.querySelector("input");
  if (el) {
    el.focus();
    el.value = addr;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}, address);
console.log("filled", address);
console.log("waiting for captcha + claim (up to 90s)...");
const started = Date.now();
while (Date.now() - started < 90000) {
  const body = await page.evaluate(() => document.body.innerText);
  if (/txHash|transaction|sent|success|explorer/i.test(body) && /0x[0-9a-fA-F]{16,}/.test(body)) {
    console.log("page says success");
    console.log(body.slice(0, 1500));
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
await browser.close();
