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

async function apiState() {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error("no /api/state");
  return r.json();
}

async function apiQrl(action, fields) {
  const r = await fetch("/api/qrl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...fields }),
  });
  return r.json();
}

function paint(s) {
  if (s.error) {
    $("tape-body").textContent = s.error;
    $("live-badge").textContent = "offline";
    return;
  }
  $("live-badge").textContent = "QRVM live";
  $("qrl-held").textContent = `${s.held} USDC`;
  $("qrl-supply").textContent = `supply ${s.total} USDC · allowance ${s.allowance} · QRC-20`;
  setA("qrl-contract", zondA(s.contract), s.contract);
  setA("qrl-holder", zondA(s.holder), s.holder);
  if (s.bridge) setA("qrl-bridge", zondA(s.bridge), s.bridge);
  if (s.sealedBridge) setA("qrl-sealed", zondA(s.sealedBridge), s.sealedBridge);
  $("qrl-minter").textContent = s.minter || "—";
  $("qrl-gas").textContent = `${Number(s.qrl).toFixed(6)} QRL`;
  $("qrl-block").textContent = String(s.block);
  if ($("approve-spender") && !$("approve-spender").value && s.bridge) $("approve-spender").value = s.bridge;
  if ($("mint-to") && !$("mint-to").value) $("mint-to").value = s.holder;
  if ($("recv-to") && !$("recv-to").value) $("recv-to").value = s.holder;
  if ($("faucet-status") && s.faucet) {
    $("faucet-status").textContent =
      `${s.faucet.remainingToday} USDC left today · ${s.faucet.perAccount} per address · day cap ${s.faucet.dailyTotal}`;
  }
}

function tape(obj) {
  $("tape-body").textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

async function loadConfig() {
  const r = await fetch("./config.json");
  return r.json();
}

let cfg = {};
let qrlProvider = null;
let qrlAccount = "";
let staticMode = false;

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

function isQrlInfo(info, provider) {
  const n = `${info?.rdns || ""} ${info?.name || ""}`.toLowerCase();
  return n.includes("qrl") || n.includes("zond") || !!provider?.isQrlWallet;
}

function pickQrlProvider() {
  for (const d of eip6963.values()) {
    if (isQrlInfo(d.info, d.provider)) return d.provider;
  }
  return window.qrl || null;
}

function watchEip6963() {
  window.addEventListener("eip6963:announceProvider", (ev) => {
    const d = ev.detail;
    if (d?.info?.uuid && d.provider) eip6963.set(d.info.uuid, d);
  });
}

async function qrlRequest(method, params = []) {
  if (!qrlProvider) throw new Error("Connect the QRL 2.0 wallet first");
  return qrlProvider.request({ method, params });
}

async function ensureQrlHttpsRpc() {
  const chainId = "0x" + Number(cfg.chainId || 1337).toString(16);
  const add = {
    chainId,
    chainName: "QRL Testnet V2",
    rpcUrls: [cfg.rpc || "https://qrlwallet.com/api/qrl-rpc/testnet"],
    blockExplorerUrls: [cfg.explorer || "https://zondscan.com"],
    nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
  };
  try {
    await qrlRequest("wallet_switchQRLChain", [{ chainId }]);
    return;
  } catch {
    /* add */
  }
  try {
    await qrlRequest("wallet_addQRLChain", [add]);
  } catch {
    /* extension network list */
  }
}

async function walletSend(to, data) {
  const from = qrlAccount;
  if (!from) throw new Error("Connect the QRL 2.0 wallet first");
  const tx = { from, to: toQ(to), data, value: "0x0" };
  const hash = await qrlRequest("qrl_sendTransaction", [tx]);
  return { tx: hash, from, to: toQ(to) };
}

async function walletAction(action, fields, s) {
  const token = s.contract || cfg.usdcQ;
  const bridge = s.bridge || cfg.bridgeQ;
  const amt = units(fields.amount || "0", s.decimals || 6);
  if (action === "transfer") return walletSend(token, calldata("0xa9059cbb", fields.to, amt));
  if (action === "approve") return walletSend(token, calldata("0x095ea7b3", fields.spender, amt));
  if (action === "burn") return walletSend(token, calldata("0x42966c68", amt));
  if (action === "depositForBurn") {
    return walletSend(bridge, calldata("0x01a8a164", amt, BigInt(fields.destinationDomain || 26), fields.mintRecipient));
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

async function claimFaucet(rail) {
  const to = qrlAccount || (await refresh()).holder;
  tape({ status: "faucet", rail, to });
  if (staticMode) {
    tape("Faucet needs the local desk (npm run web). GitHub Pages cannot mint.");
    return;
  }
  const out = await apiQrl("faucet", { rail, to, amount: "2" });
  tape(out);
  setTimeout(refresh, 4000);
}

$("faucet-qrl")?.addEventListener("click", () => claimFaucet("qrl"));
$("faucet-arc")?.addEventListener("click", () => claimFaucet("arc"));

$("qrl-connect").addEventListener("click", async () => {
  try {
    qrlProvider = pickQrlProvider();
    if (!qrlProvider) {
      $("qrl-account").innerHTML =
        'No QRL 2.0 wallet found. Install the official <a href="https://github.com/theQRL/qrl-web3-wallet/releases/latest" target="_blank" rel="noreferrer">QRL Web3 Wallet</a>, then reload this page.';
      return;
    }
    const acc = await qrlRequest("qrl_requestAccounts");
    qrlAccount = Array.isArray(acc) ? acc[0] : acc;
    $("qrl-account").textContent = toQ(qrlAccount) || "connected";
    tape({ connected: toQ(qrlAccount) });
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

$("arc-connect").addEventListener("click", async () => {
  if (!window.ethereum) {
    $("arc-account").textContent = "No injected EVM wallet";
    return;
  }
  try {
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ARC] });
    const acc = await window.ethereum.request({ method: "eth_requestAccounts" });
    $("arc-account").textContent = acc[0] || "connected";
  } catch (err) {
    $("arc-account").textContent = err.message || String(err);
  }
});

watchEip6963();
cfg = await loadConfig().catch(() => ({}));
setTimeout(() => {
  if (pickQrlProvider()) $("qrl-account").textContent = "QRL 2.0 wallet detected — click Connect";
}, 400);
await refresh();
setInterval(refresh, 12000);
