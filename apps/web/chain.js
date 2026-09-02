export function canonQ(addr) {
  const s = String(addr || "").trim();
  if (!s) return "";
  if (s.startsWith("Q") || s.startsWith("q")) return "Q" + s.slice(1).toLowerCase();
  if (s.startsWith("0x") || s.startsWith("0X")) return "Q" + s.slice(2).toLowerCase();
  return "Q" + s.toLowerCase();
}

export function findTokenBalance(tokensResp, wantQ) {
  const want = canonQ(wantQ);
  if (!want) return null;
  const list = tokensResp?.tokens || [];
  const tok = list.find((t) => canonQ(t.contractAddress) === want);
  if (!tok) return null;
  return { raw: String(tok.balance ?? "0"), decimals: tok.decimals ?? 6, symbol: tok.symbol };
}

export function rawToDisplay(raw, decimals = 6) {
  const s = String(raw ?? "0");
  const n = BigInt(s.startsWith("0x") || s.startsWith("0X") ? s : s);
  const d = 10n ** BigInt(decimals);
  const w = n / d;
  let f = (n % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : `${w}`;
}

export function inventoryFromZond(cfg, parts) {
  const usdc = cfg.usdcQ;
  const decimals = cfg.decimals || 6;
  const heldTok = findTokenBalance(parts.holderTokens, usdc);
  const faucetTok = findTokenBalance(parts.faucetTokens, usdc);
  const held = heldTok ? rawToDisplay(heldTok.raw, heldTok.decimals ?? decimals) : undefined;
  const faucetHeld = faucetTok ? rawToDisplay(faucetTok.raw, faucetTok.decimals ?? decimals) : undefined;
  const qrl = parts.holderAgg?.address?.balance ?? parts.holderAgg?.balance;
  const block = parts.latest?.blockNumber;
  return {
    held,
    faucetHeld,
    pool: faucetHeld ?? held,
    qrl: qrl == null ? undefined : qrl,
    block: block == null ? undefined : block,
  };
}

async function zondJson(path) {
  const r = await fetch(`https://zondscan.com/api${path}`);
  const text = await r.text();
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 80)}`);
  if (!ct.includes("json") && !/^\s*[\[{]/.test(text)) throw new Error("not json");
  return JSON.parse(text);
}

export function zondNonceHex(agg) {
  const n = agg?.address?.nonce ?? agg?.nonce ?? 0;
  return "0x" + Number(n).toString(16);
}

export function shortAddr(addr) {
  const q = canonQ(addr);
  if (!q) return "";
  if (q.length <= 12) return q;
  return q.slice(0, 6) + "..." + q.slice(-4);
}

export function userUsdcDisplay(tokensResp, usdcQ, decimals = 6) {
  const tok = findTokenBalance(tokensResp, usdcQ);
  if (!tok) return "0";
  return rawToDisplay(tok.raw, tok.decimals ?? decimals);
}

export async function loadLiveInventory(cfg) {
  const holder = canonQ(cfg.holderQ);
  const faucet = canonQ(cfg.faucetQ);
  const [holderTokens, faucetTokens, latest, holderAgg] = await Promise.all([
    holder ? zondJson(`/address/${holder}/tokens`) : {},
    faucet ? zondJson(`/address/${faucet}/tokens`) : {},
    zondJson("/latestblock"),
    holder ? zondJson(`/address/aggregate/${holder}`) : {},
  ]);
  return inventoryFromZond(cfg, { holderTokens, faucetTokens, latest, holderAgg });
}
