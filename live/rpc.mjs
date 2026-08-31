export const QRL_RPC = process.env.QRL_RPC || "https://qrlwallet.com/api/qrl-rpc/testnet";
export const QRL_CHAIN_ID = 1337;
export const EXPLORER = "https://zondscan.com";
export const FAUCET_CLAIM = "https://zondscan.com/faucet/claim";

export async function qrlRpc(method, params = [], url = process.env.QRL_RPC || QRL_RPC) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

export function toQ(addr) {
  const s = String(addr);
  if (s.startsWith("Q") || s.startsWith("q")) return "Q" + s.slice(1);
  if (s.startsWith("0x") || s.startsWith("0X")) return "Q" + s.slice(2);
  return "Q" + s;
}

export function to0x(addr) {
  const s = String(addr);
  if (s.startsWith("Q") || s.startsWith("q")) return "0x" + s.slice(1);
  if (s.startsWith("0x") || s.startsWith("0X")) return "0x" + s.slice(2);
  return "0x" + s;
}
