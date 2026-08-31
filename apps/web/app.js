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
  if (!$("approve-spender").value && s.bridge) $("approve-spender").value = s.bridge;
  if (!$("mint-to").value) $("mint-to").value = s.holder;
  if (!$("recv-to").value) $("recv-to").value = s.holder;
}

function tape(obj) {
  $("tape-body").textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
}

async function loadConfig() {
  const r = await fetch("./config.json");
  return r.json();
}

function setStaticMode(on) {
  document.body.classList.toggle("static-pages", on);
  const badge = $("live-badge");
  if (on && badge && !badge.dataset.tx) badge.textContent = "github pages";
  for (const form of document.querySelectorAll("form[data-action]")) {
    const btn = form.querySelector("button[type=submit]");
    if (btn) btn.disabled = on;
  }
}

async function refresh() {
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
    const c = await loadConfig();
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
      const out = await apiQrl(action, fields);
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

await refresh();
setInterval(refresh, 12000);
