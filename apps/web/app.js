import {
  ANNOUNCE_PROVIDER,
  REQUEST_PROVIDER,
  collectEvmWallets,
  findWallet,
  pickQrlProvider as pickQrlFrom,
  shouldSkipLiveApi,
  walletRpcUrl,
} from "./wallets.js";
import { loadLiveInventory, userUsdcDisplay, zondNonceHex } from "./chain.js";

const $ = (id) => document.getElementById(id);

function toQ(addr) {
  if (!addr) return "";
  const s = String(addr).trim();
  if (!s) return "";
  if (s.startsWith("Q") || s.startsWith("q")) return "Q" + s.slice(1);
  if (s.startsWith("0x") || s.startsWith("0X")) return "Q" + s.slice(2);
  return "Q" + s;
}

function zondA(q) {
  return `https://zondscan.com/address/${toQ(q)}`;
}

function zondTx(h) {
  return `https://zondscan.com/tx/${h}`;
}

function setA(id, href, text) {
  const el = $(id);
  if (!el) return;
  el.href = href;
  el.textContent = text;
}

function formData(form) {
  const o = {};
  for (const [k, v] of new FormData(form).entries()) o[k] = v;
  return o;
}

async function readJson(r) {
  const text = await r.text();
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 80)}`);
  if (!ct.includes("json") && !/^\s*[\[{]/.test(text)) throw new Error("not json");
  return JSON.parse(text);
}

async function apiState() {
  if (shouldSkipLiveApi(location.hostname)) throw new Error("no /api/state");
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error("no /api/state");
  return readJson(r);
}

async function apiQrl(action, fields) {
  const r = await fetch("/api/qrl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...fields }),
  });
  return readJson(r);
}

function paint(s) {
  if (s.error) {
    $("tape-body").textContent = s.error;
    $("live-badge").textContent = "offline";
    return;
  }
  paintCodeWatch(s);
  $("live-badge").textContent = s.codeWatch && !s.codeWatch.ok ? "CODE WRONG" : "QRVM live";
  const pool = s.pool ?? s.faucetHeld ?? s.held;
  $("qrl-held").textContent = `${pool} USDC`;
  $("qrl-supply").textContent = s.faucetHeld != null
    ? `faucet remaining ${s.faucetHeld} USDC · supply ${s.total} USDC`
    : `supply ${s.total} USDC · allowance ${s.allowance} · QRC-20`;
  setA("qrl-contract", zondA(s.contract), s.contract);
  setA("qrl-holder", zondA(s.holder), s.holder);
  if (s.bridge) setA("qrl-bridge", zondA(s.bridge), s.bridge);
  if (s.sealedBridge) setA("qrl-sealed", zondA(s.sealedBridge), s.sealedBridge);
  $("qrl-minter").textContent = s.minter || "—";
  $("qrl-gas").textContent = `${Number(s.qrl).toFixed(6)} QRL`;
  $("qrl-block").textContent = String(s.block);

  if ($("mint-to") && !$("mint-to").value) $("mint-to").value = s.holder;
  if ($("recv-to") && !$("recv-to").value) $("recv-to").value = s.holder;
  const op = toQ(s.holder);
  const guest = qrlAccount && toQ(qrlAccount) !== op;
  for (const id of ["sanc-block", "sanc-clear"]) {
    const el = $(id);
    if (el) el.hidden = !!guest || staticMode;
  }
  if ($("sanc-out") && guest) $("sanc-out").textContent = "Flag and clear are operator-only. Anyone can Check.";
  paintReports(s);
  if ($("faucet-status")) {
    const f = s.faucetQ || cfg.faucetQ;
    $("faucet-status").textContent = f
      ? `On-chain drip ${f} · 2 USDC / address / UTC day · 9 USDC / day total · wallet signature only`
      : "On-chain faucet address missing from config";
  }
}

function paintCodeWatch(s) {
  const siren = $("code-siren");
  const list = $("code-siren-list");
  const watch = s.codeWatch;
  const bad = watch && watch.ok === false && (watch.alarms || []).length;
  document.body.classList.toggle("code-wrong", !!bad);
  if (!siren) return;
  if (!bad) {
    siren.hidden = true;
    if (list) list.innerHTML = "";
    return;
  }
  siren.hidden = false;
  if (list) {
    list.innerHTML = watch.alarms
      .map((a) => {
        const why =
          {
            "empty-code": "no code at this address",
            "live-vs-pin": "live bytecode is not the pinned hash (on-chain swap)",
            "live-vs-build": "live bytecode is not this repo's published build (GitHub/source edit or stale deploy)",
            "pin-vs-build": "pinned hash does not match the published build (config or repo edited)",
            "source-changed": "Hyperion source in this repo no longer matches the pinned source hash",
            unpinned: "no pin and no build artifact",
            "rpc-failed": "could not read chain",
          }[a.reason] || a.reason;
        return `<li><strong>${a.name}</strong> ${a.address || ""} — ${why}<br>pin ${a.pin || "—"}<br>build ${a.build || "—"}<br>live ${a.live || "—"}</li>`;
      })
      .join("");
  }
}

function fmtUnits(hex, decimals) {
  try {
    const n = BigInt(hex || "0");
    const d = 10n ** BigInt(decimals);
    const w = n / d;
    let f = (n % d).toString().padStart(decimals, "0").replace(/0+$/, "");
    return f ? `${w}.${f}` : `${w}`;
  } catch {
    return "—";
  }
}

function paintUser(u) {
  if (!$("user-usdc")) return;
  if (!u) {
    $("user-usdc").textContent = "—";
    $("user-qrl").textContent = "Connect the QRL wallet to see your USDC and QRL.";
    return;
  }
  $("user-usdc").textContent = `${u.usdc} USDC`;
  $("user-qrl").textContent = `${u.qrl} QRL · ${u.account}`;
}

async function zondSoft(path) {
  try {
    const r = await fetch(`https://zondscan.com/api${path}`);
    if (!r.ok) return {};
    return await readJson(r);
  } catch {
    return {};
  }
}

async function pollUser() {
  if (!qrlAccount) {
    paintUser(null);
    return;
  }
  try {
    if (!cfg.usdcQ) cfg = await loadConfig().catch(() => cfg);
    const acc = toQ(qrlAccount);
    const [info, tokens] = await Promise.all([
      zondSoft(`/address/aggregate/${acc}`),
      zondSoft(`/address/${acc}/tokens`),
    ]);
    const qrl = info?.address?.balance ?? info?.balance ?? 0;
    paintUser({
      account: acc,
      qrl: String(qrl),
      usdc: userUsdcDisplay(tokens, cfg.usdcQ, cfg.decimals || 6),
    });
  } catch (err) {
    paintUser({ account: toQ(qrlAccount), qrl: "—", usdc: "0" });
    if ($("user-qrl")) $("user-qrl").textContent = err.message || "could not read balances";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tape(obj) {
  $("tape-body").textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

async function loadConfig() {
  const r = await fetch("./config.json");
  return readJson(r);
}

let cfg = {};
let qrlProvider = null;
let qrlAccount = "";
let staticMode = false;
let nextNonce = null;

function setStaticMode(on) {
  staticMode = on;
  document.body.classList.toggle("static-pages", on);
  const badge = $("live-badge");
  if (on && badge && !badge.dataset.tx) badge.textContent = "github pages";
  for (const form of document.querySelectorAll("form[data-operator]")) {
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = on;
  }
}

function pad64(hex) {
  return hex.replace(/^0x/i, "").replace(/^Q/i, "").toLowerCase().padStart(64, "0");
}

function units(amount, decimals = 6) {
  const [w, f = ""] = String(amount).trim().split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function calldata(sel, ...words) {
  return sel + words.map((w) => pad64(typeof w === "bigint" ? w.toString(16) : String(w))).join("");
}

const eip6963 = new Map();

function currentQrlProvider() {
  return pickQrlFrom(eip6963, window);
}

function evmWallets() {
  return collectEvmWallets(eip6963, window.ethereum);
}

function renderArcPicker() {
  const sel = $("arc-wallet-pick");
  if (!sel) return;
  const wallets = evmWallets();
  const prev = sel.value || sessionStorage.getItem("arcWalletUuid") || "";
  sel.innerHTML = wallets.length
    ? wallets.map((d) => `<option value="${d.info.uuid}">${d.info.name} (${d.info.rdns || "injected"})</option>`).join("")
    : `<option value="">No Arc wallet yet — unlock and Refresh</option>`;
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

let lastProviderRequest = 0;
function requestEip6963() {
  const now = Date.now();
  if (now - lastProviderRequest < 1500) return;
  lastProviderRequest = now;
  window.dispatchEvent(new Event(REQUEST_PROVIDER));
}

function watchEip6963() {
  window.addEventListener(ANNOUNCE_PROVIDER, (ev) => {
    const d = ev.detail;
    if (d?.info?.uuid && d.provider) {
      eip6963.set(d.info.uuid, d);
      renderArcPicker();
    }
  });
  requestEip6963();
}

function rpcFail(err) {
  const msg = err?.message || String(err);
  if (/failed to fetch|networkerror|err_connection|load failed/i.test(msg)) {
    return new Error("Wallet could not reach its node RPC. Connect still works; balances load from ZondScan.");
  }
  return err instanceof Error ? err : new Error(msg);
}

async function qrlRequest(method, params = []) {
  if (!qrlProvider) throw new Error("Connect the QRL 2.0 wallet first");
  try {
    return await qrlProvider.request({ method, params });
  } catch (err) {
    throw rpcFail(err);
  }
}

async function ensureQrlHttpsRpc() {
  const chainId = "0x" + Number(cfg.chainId || 1337).toString(16);
  const rpc = walletRpcUrl(location, cfg.rpc);
  if (shouldSkipLiveApi(location.hostname) && /qrlwallet\.com/i.test(rpc)) return;
  const add = {
    chainId,
    chainName: "QRL Testnet V2 (public HTTPS)",
    rpcUrls: [rpc],
    blockExplorerUrls: [cfg.explorer || "https://zondscan.com"],
    nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
  };
  // Add first. Switch-only would keep the dead 209.250.255.226:8545 node.
  try {
    await qrlRequest("wallet_addQRLChain", [add]);
  } catch {
    /* already present */
  }
  try {
    await qrlRequest("wallet_switchQRLChain", [{ chainId }]);
  } catch {
    /* user rejected */
  }
}

async function walletSend(to, data, value = "0x0") {
  const from = qrlAccount;
  if (!from) throw new Error("Connect the QRL 2.0 wallet first");
  if (nextNonce == null) {
    const agg = await zondSoft(`/address/aggregate/${toQ(from)}`);
    nextNonce = Number(BigInt(zondNonceHex(agg)));
  }
  const tx = {
    from,
    to: toQ(to),
    data,
    value,
    gas: "0x40000",
    gasPrice: "0x9502f907",
    nonce: "0x" + nextNonce.toString(16),
    chainId: "0x" + Number(cfg.chainId || 1337).toString(16),
  };
  let hash;
  try {
    hash = await qrlRequest("qrl_sendTransaction", [tx]);
  } catch (err) {
    try {
      hash = await qrlRequest("eth_sendTransaction", [tx]);
    } catch {
      throw err;
    }
  }
  nextNonce += 1;
  return { tx: hash, from: toQ(from), to: toQ(to) };
}

function asciiTag(text) {
  const s = String(text || "report").slice(0, 32);
  let hex = "";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(2, "0");
  return "0x" + hex.padEnd(64, "0");
}

function paintReports(s) {
  const box = $("report-list");
  if (!box) return;
  const items = s.reports?.items || [];
  if (!items.length) {
    box.textContent = "No reports yet.";
    return;
  }
  box.innerHTML = items
    .map(
      (r) =>
        `<li><span class="mute">#${r.id}</span> ${r.subject} <span class="mute">by ${r.reporter} · block ${r.atBlock} · ${r.paidQrl} QRL</span></li>`,
    )
    .join("");
}

async function walletAction(action, fields, s) {
  const token = s.contract || cfg.usdcQ;
  const bridge = s.bridge || cfg.bridgeQ;
  const amt = units(fields.amount || "0", s.decimals || 6);
  if (action === "transfer") return walletSend(token, calldata("0xa9059cbb", fields.to, amt));
  if (action === "approve") return walletSend(token, calldata("0x095ea7b3", fields.spender, amt));
  if (action === "burn") return walletSend(token, calldata("0x42966c68", amt));
  if (action === "depositForBurn") {
    const allow = await walletSend(token, calldata("0x095ea7b3", bridge, amt));
    const burn = await walletSend(bridge, calldata("0x01a8a164", amt, BigInt(fields.destinationDomain || 26), fields.mintRecipient));
    return { allow, ...burn };
  }
  throw new Error(`${action} is operator-only`);
}

async function refresh() {
  if (!cfg.usdcQ) cfg = await loadConfig().catch(() => cfg);
  let s = {};
  let staticMode = false;
  try {
    s = await apiState();
  } catch {
    staticMode = true;
  }
  if (!s || s.error || !s.contract) {
    staticMode = true;
    let snap = {};
    try {
      const r = await fetch("./state.json");
      if (r.ok) snap = await r.json();
    } catch {
      snap = {};
    }
    cfg = await loadConfig();
    const c = cfg;
    s = {
      ...c,
      ...snap,
      contract: snap.contract || c.usdcQ,
      holder: snap.holder || c.holderQ,
      bridge: snap.bridge || c.bridgeQ,
      sealedBridge: snap.sealedBridge || c.sealedBridge,
      held: snap.held ?? "—",
      total: snap.total ?? "—",
      allowance: snap.allowance ?? "—",
      qrl: snap.qrl ?? 0,
      block: snap.block ?? "—",
      minter: snap.minter || c.bridgeQ,
    };
  }
  try {
    const live = await loadLiveInventory(cfg);
    s = {
      ...s,
      held: live.held ?? s.held,
      faucetHeld: live.faucetHeld ?? s.faucetHeld,
      pool: live.pool ?? s.pool,
      qrl: live.qrl ?? s.qrl,
      block: live.block ?? s.block,
    };
  } catch {
    /* snapshot /api/state still paints */
  }
  setStaticMode(staticMode);
  paint(s);
  return s;
}

for (const form of document.querySelectorAll("form[data-action]")) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const action = form.dataset.action;
    const fields = formData(form);
    tape({ status: "sending", action, ...fields });
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      let out;
      const operator = form.hasAttribute("data-operator");
      if (!operator && qrlAccount) out = await walletAction(action, fields, await refresh());
      else if (!staticMode) out = await apiQrl(action, fields);
      else throw new Error("Connect the QRL 2.0 wallet to send this transaction");
      tape(out);
      if (out.error) $("live-badge").textContent = "tx error";
      else {
        $("live-badge").textContent = "tx sent";
        if (out.tx) {
          const a = document.createElement("div");
          tape({ ...out, explorer: zondTx(out.tx) });
        }
        setTimeout(refresh, 8000);
      }
    } catch (err) {
      tape(String(err.message || err));
    } finally {
      btn.disabled = false;
    }
  });
}

const ARC = {
  chainId: "0x4cef52",
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.io"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

async function ensureQrlConnected() {
  if (qrlAccount && qrlProvider) return qrlAccount;
  qrlProvider = currentQrlProvider();
  if (!qrlProvider) throw new Error("Install and unlock the official QRL 2.0 wallet, then retry");
  const acc = await qrlRequest("qrl_requestAccounts");
  qrlAccount = Array.isArray(acc) ? acc[0] : acc;
  nextNonce = null;
  if ($("qrl-account")) $("qrl-account").textContent = toQ(qrlAccount) || "connected";
  return qrlAccount;
}

async function claimFaucet(rail) {
  const status = $("faucet-status");
  try {
  if (!cfg.faucetQ) cfg = await loadConfig().catch(() => cfg);
  if (rail === "qrl") {
    await ensureQrlConnected();
    const faucet = cfg.faucetQ;
    if (!faucet) throw new Error("on-chain faucet not deployed");
    const before = $("user-usdc")?.textContent;
    if (status) status.textContent = "Approve drip() in the QRL wallet…";
    const out = await walletSend(faucet, "0x9f678cca");
    tape({ drip: out, faucet, explorer: zondTx(out.tx) });
    if (status) status.textContent = `Drip sent ${out.tx}. QRL blocks are ~1 min. Waiting for ZondScan…`;
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      await pollUser();
      await refresh();
      const now = $("user-usdc")?.textContent;
      if (now && now !== before && !now.startsWith("—")) {
        if (status) status.textContent = `Received. Your wallet now shows ${now}.`;
        return;
      }
      if (status) status.textContent = `Drip sent. Waiting for the next QRL block (${i + 1}/24)… ${zondTx(out.tx)}`;
    }
    if (status) status.textContent = `Tx sent. If USDC is still 0, open ${zondTx(out.tx)} — the indexer lags a block.`;
    return;
  }
  const circle = cfg.circleFaucet || "https://faucet.circle.com/";
  window.open(circle, "_blank", "noopener,noreferrer");
  tape({
    rail: "arc",
    open: circle,
    hint: "Select Arc Testnet, USDC, Send 20 USDC. Limit: once per address every 2 hours.",
  });
  } catch (err) {
    const msg = err.message || String(err);
    tape({ error: msg });
    if (status) status.textContent = msg;
  }
}

async function sanc(action, on) {
  const to = $("sanc-addr")?.value;
  if (staticMode) {
    $("sanc-out").textContent = "Sanctions demo runs on the local desk.";
    return;
  }
  const s = await refresh();
  const actor = s.holder;
  if (action === "sanctionSet") {
    if (qrlAccount && toQ(qrlAccount) !== toQ(actor)) {
      $("sanc-out").textContent = "Flag and clear are operator-only.";
      return;
    }
    if (!on && !window.confirm("Clear this address? On-chain, unlist needs owner and guardian.")) return;
  }
  const out = await apiQrl(action, { to, on, actor, confirm: on ? undefined : "clear" });
  $("sanc-out").textContent = JSON.stringify(out);
  tape(out);
}

$("sanc-check")?.addEventListener("click", () => sanc("sanctionCheck"));
$("sanc-block")?.addEventListener("click", () => sanc("sanctionSet", true));
$("sanc-clear")?.addEventListener("click", () => sanc("sanctionSet", false));

$("report-send")?.addEventListener("click", async () => {
  try {
    const board = cfg.reportBoardQ || (await refresh()).reportBoard;
    if (!board) throw new Error("report board not deployed");
    const subject = $("report-subject")?.value;
    const note = $("report-note")?.value;
    const fee = BigInt(cfg.reportMinFee || "10000000000000000");
    const data = calldata("0xcaf2cbc5", subject, asciiTag(note).replace(/^0x/, ""));
    const out = await walletSend(board, data, "0x" + fee.toString(16));
    tape(out);
    setTimeout(refresh, 5000);
  } catch (err) {
    tape({ error: err.message || String(err) });
  }
});

$("add-token")?.addEventListener("click", async () => {
  try {
    await ensureQrlConnected();
    if (!cfg.usdcQ) cfg = await loadConfig();
    const ok = await qrlProvider.request({
      method: "wallet_watchAsset",
      params: [
        {
          type: "ERC20",
          options: {
            address: toQ(cfg.usdcQ),
            symbol: "USDC",
            decimals: 6,
            image: cfg.tokenImage || new URL("./usdc.png", location.href).href,
          },
        },
      ],
    });
    tape({
      watchAsset: ok,
      token: toQ(cfg.usdcQ),
      symbol: "USDC",
      decimals: 6,
      image: cfg.tokenImage,
      hint: "This is a new contract, not a logo on the old one. Hide Q34ab8332… if it is still listed, then Add USDC again so the wallet stores https://pq-cybarg.github.io/arql/usdc.png.",
    });
  } catch (err) {
    tape({
      error: err.message || String(err),
      hint: "Import Qadf94bb6e061a9f3b1d54826241eba701d43fb86 (not Q34ab8332…). Hide the old row first; wallets keep the first icon they stored.",
    });
  }
});

$("faucet-qrl")?.addEventListener("click", () => claimFaucet("qrl"));
$("faucet-arc")?.addEventListener("click", () => claimFaucet("arc"));

$("qrl-connect").addEventListener("click", async () => {
  try {
    qrlProvider = currentQrlProvider();
    if (!qrlProvider) {
      $("qrl-account").innerHTML =
        'No QRL 2.0 wallet found. Install the official <a href="https://github.com/theQRL/qrl-web3-wallet/releases/latest" target="_blank" rel="noreferrer">QRL Web3 Wallet</a>, then reload this page.';
      return;
    }
    const acc = await qrlRequest("qrl_requestAccounts");
    qrlAccount = Array.isArray(acc) ? acc[0] : acc;
    nextNonce = null;
    $("qrl-account").textContent = toQ(qrlAccount) || "connected";
    tape({ connected: toQ(qrlAccount) });
    pollUser();
    ensureQrlHttpsRpc().catch(() => {});
  } catch (err) {
    const msg = err.message || String(err);
    const stale = /extension context invalidated/i.test(msg);
    $("qrl-account").textContent = stale
      ? "Wallet extension was reloaded. Refresh this tab, then Connect again."
      : msg;
    tape({
      error: msg,
      hint: stale
        ? "chrome://extensions Reload leaves a dead content script in open tabs. Refresh this page."
        : "QRL Testnet RPC must be https://qrlwallet.com/api/qrl-rpc/testnet (qrl_ methods).",
    });
  }
});

$("arc-wallet-pick")?.addEventListener("change", (e) => {
  sessionStorage.setItem("arcWalletUuid", e.target.value);
});

$("arc-wallet-pick")?.addEventListener("focus", () => {
  requestEip6963();
  renderArcPicker();
});

$("arc-refresh")?.addEventListener("click", () => {
  lastProviderRequest = 0;
  requestEip6963();
  renderArcPicker();
  const n = evmWallets().length;
  $("arc-account").textContent = n
    ? `${n} Arc wallet${n === 1 ? "" : "s"} listed. Pick one, then Connect.`
    : "No Arc wallet announced yet. Unlock the extension, then Refresh.";
});

$("arc-connect").addEventListener("click", async () => {
  requestEip6963();
  renderArcPicker();
  const uuid = $("arc-wallet-pick")?.value;
  const d = findWallet(evmWallets(), eip6963, uuid);
  if (!d?.provider) {
    $("arc-account").textContent = "Pick an Arc wallet in the list. Unlock it and click Refresh if it is missing.";
    return;
  }
  sessionStorage.setItem("arcWalletUuid", d.info.uuid);
  try {
    const p = d.provider;
    try {
      await p.request({ method: "wallet_addEthereumChain", params: [ARC] });
    } catch {
      /* already added */
    }
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.chainId }] });
    } catch {
      /* user rejected switch */
    }
    const acc = await p.request({ method: "eth_requestAccounts" });
    $("arc-account").textContent = `${d.info.name}: ${acc[0] || "connected"}`;
    tape({ arcWallet: d.info.name, rdns: d.info.rdns, account: acc[0] });
  } catch (err) {
    $("arc-account").textContent = err.message || String(err);
  }
});

watchEip6963();
cfg = await loadConfig().catch(() => ({}));
setTimeout(() => {
  if (currentQrlProvider()) $("qrl-account").textContent = "QRL 2.0 wallet detected — click Connect";
}, 400);
await refresh();
pollUser();
setInterval(refresh, 12000);
setInterval(pollUser, 5000);
