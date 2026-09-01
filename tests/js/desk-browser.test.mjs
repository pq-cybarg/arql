import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DESK = process.env.DESK_URL || "http://127.0.0.1:7470/";

test("Arc picker requests EIP-6963 providers and lists a late announcer", async (t) => {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    t.skip("puppeteer-core not installed");
    return;
  }
  if (!existsSync(CHROME)) {
    t.skip("Chrome not installed");
    return;
  }
  let live = false;
  try {
    const r = await fetch(DESK, { signal: AbortSignal.timeout(1500) });
    live = r.ok;
  } catch {
    live = false;
  }
  if (!live) {
    t.skip("desk server not running");
    return;
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-extensions"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__arqlRequests = 0;
      window.addEventListener("eip6963:requestProvider", () => {
        window.__arqlRequests += 1;
      });
    });
    await page.goto(DESK, { waitUntil: "networkidle0", timeout: 20000 });
    const requested = await page.evaluate(() => window.__arqlRequests);
    assert.ok(requested >= 1, `expected requestProvider, got ${requested}`);

    await page.evaluate(() => {
      const provider = { request: async () => ["0xabc"] };
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info: { uuid: "test-late-wallet", name: "LateWallet", rdns: "io.arql.test" }, provider },
        }),
      );
    });
    const label = await page.$eval("#arc-wallet-pick", (el) => el.options[el.selectedIndex]?.textContent || el.textContent);
    assert.match(label, /LateWallet/);

    const icon = await page.$eval('link[rel="icon"]', (el) => el.getAttribute("href"));
    assert.equal(icon, "./usdc.png");
  } finally {
    await browser.close();
  }
});
