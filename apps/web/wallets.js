export const REQUEST_PROVIDER = "eip6963:requestProvider";
export const ANNOUNCE_PROVIDER = "eip6963:announceProvider";

export function isQrlInfo(info, provider) {
  const n = `${info?.rdns || ""} ${info?.name || ""}`.toLowerCase();
  return n.includes("qrl") || n.includes("zond") || !!(provider?.isQrlWallet || provider?.isZond);
}

export function injectedWalletName(provider) {
  if (!provider) return "Injected wallet";
  if (provider.isQrlWallet || provider.isZond) return "QRL Wallet (injected)";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isRabby) return "Rabby";
  if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
  if (provider.isCoinbaseWallet || provider.isBaseWallet) return "Coinbase Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isRainbow) return "Rainbow";
  if (provider.isTrust || provider.isTrustWallet) return "Trust Wallet";
  if (provider.isFrame) return "Frame";
  if (provider.isTokenPocket) return "TokenPocket";
  if (provider.isBitKeep || provider.isBitgetWallet) return "Bitget Wallet";
  if (provider.isMetaMask) return "MetaMask (injected)";
  return "Injected wallet";
}

function announcedList(announced) {
  if (!announced) return [];
  if (typeof announced.values === "function") return [...announced.values()];
  return Array.isArray(announced) ? announced : [];
}

export function collectEvmWallets(announced, injected) {
  const out = [];
  const seen = new Set();
  for (const d of announcedList(announced)) {
    if (!d?.info?.uuid || !d.provider) continue;
    if (isQrlInfo(d.info, d.provider)) continue;
    out.push(d);
    seen.add(d.provider);
  }
  if (injected && !seen.has(injected) && !isQrlInfo({ name: injectedWalletName(injected) }, injected)) {
    out.push({
      info: {
        uuid: "injected-ethereum",
        name: injectedWalletName(injected),
        rdns: "injected.ethereum",
      },
      provider: injected,
    });
  }
  return out;
}

export function pickQrlProvider(announced, globals = {}) {
  const qs = [];
  for (const d of announcedList(announced)) {
    if (d?.provider && isQrlInfo(d.info, d.provider)) qs.push(d);
  }
  const official = qs.find((d) => /theqrl|qrlwallet/i.test(`${d.info?.rdns || ""} ${d.info?.name || ""}`));
  if (official) return official.provider;
  if (qs[0]) return qs[0].provider;
  if (globals.qrl) return globals.qrl;
  if (globals.zond) return globals.zond;
  if (globals.ethereum && isQrlInfo({}, globals.ethereum)) return globals.ethereum;
  return null;
}

export function detectedWalletLabel(hasProvider, connected) {
  if (connected) return "";
  if (hasProvider) return "QRL 2.0 wallet found. Click Connect.";
  return "Not connected";
}

export function shouldSkipLiveApi(hostname) {
  return /github\.io$/i.test(String(hostname || ""));
}

export function walletRpcUrl(locationLike, cfgRpc) {
  const host = locationLike?.hostname || "";
  if (host === "localhost" || host === "127.0.0.1") {
    return `${locationLike.origin}/api/qrl-rpc`;
  }
  return cfgRpc || "https://qrlwallet.com/api/qrl-rpc/testnet";
}

export function findWallet(wallets, announced, uuid) {
  if (uuid && Array.isArray(wallets)) {
    const hit = wallets.find((d) => d?.info?.uuid === uuid);
    if (hit) return hit;
  }
  if (uuid && announced && typeof announced.get === "function") {
    const hit = announced.get(uuid);
    if (hit) return hit;
  }
  return (wallets && wallets[0]) || null;
}
