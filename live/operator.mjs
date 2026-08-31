import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadOrCreateWallet } from "./wallet.mjs";
import { QRL_RPC, toQ, to0x, qrlRpc } from "./rpc.mjs";

const require = createRequire(import.meta.url);
const { Web3 } = require("@theqrl/web3");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached;

export function loadMeta() {
  const p = path.join(root, "deployments/qrl-testnet.json");
  if (!fs.existsSync(p)) throw new Error("no deployments/qrl-testnet.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadAbis() {
  return {
    usdc: JSON.parse(fs.readFileSync(path.join(root, "live/out/QRC20USDC.json"), "utf8")),
    bridge: fs.existsSync(path.join(root, "live/out/ArqlBridge.json"))
      ? JSON.parse(fs.readFileSync(path.join(root, "live/out/ArqlBridge.json"), "utf8"))
      : null,
  };
}

export function getWeb3() {
  if (cached) return cached;
  const wallet = loadOrCreateWallet();
  const web3 = new Web3(new Web3.providers.HttpProvider(QRL_RPC));
  const acc = web3.qrl.accounts.seedToAccount(wallet.hexseed);
  web3.qrl.wallet.add(wallet.hexseed);
  cached = { web3, acc, wallet };
  return cached;
}

export async function send(to, data, gasHint = 400000n) {
  const { web3, acc } = getWeb3();
  const gasPrice = await web3.qrl.getGasPrice();
  let gas = gasHint;
  try {
    const est = await qrlRpc("qrl_estimateGas", [{ from: acc.address, to: toQ(to), data }]);
    gas = (BigInt(est) * 15n) / 10n;
  } catch {
    /* public RPC may block estimateGas */
  }
  const receipt = await web3.qrl.sendTransaction(
    { from: acc.address, to: toQ(to), data, gas, gasPrice },
    undefined,
    { checkRevertBeforeSending: false },
  );
  return { tx: receipt.transactionHash, from: toQ(acc.address), to: toQ(to) };
}

export function units(usdc) {
  const n = String(usdc).trim();
  const [w, f = ""] = n.split(".");
  const frac = (f + "000000").slice(0, 6);
  return BigInt(w || "0") * 1000000n + BigInt(frac);
}

export { toQ, to0x };
