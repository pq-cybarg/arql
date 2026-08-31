#!/usr/bin/env node
/** Deploy QRC-20 USDC to a local unlocked gqrl --dev QRVM (20-byte). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { qrlRpc, toQ, to0x, EXPLORER } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artPath = path.join(root, "live/out/QRC20USDC.json");
if (!fs.existsSync(artPath)) {
  const r = spawnSync(process.execPath, [path.join(root, "live/compile.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const art = JSON.parse(fs.readFileSync(artPath, "utf8"));
const accounts = await qrlRpc("qrl_accounts", []);
const from = accounts[0];
console.log("from", from);
const bal = await qrlRpc("qrl_getBalance", [from, "latest"]);
console.log("balance", bal);
const gasPrice = await qrlRpc("qrl_gasPrice", []);
const gas = "0x" + (2_000_000).toString(16);

const txHash = await qrlRpc("qrl_sendTransaction", [
  { from, data: art.bytecode, gas, gasPrice },
]);
console.log("deploy tx", txHash);

let receipt = null;
for (let i = 0; i < 30; i++) {
  receipt = await qrlRpc("qrl_getTransactionReceipt", [txHash]);
  if (receipt && receipt.contractAddress) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!receipt?.contractAddress) throw new Error("no contractAddress: " + JSON.stringify(receipt));
const contract = receipt.contractAddress;
console.log("QRC-20 USDC", contract);

// mint(address,uint256) selector 0x40c10f19
const mintSel = "0x40c10f19";
const toPad = to0x(from).slice(2).padStart(64, "0");
const amtPad = (1_000_000_000n).toString(16).padStart(64, "0");
const mintHash = await qrlRpc("qrl_sendTransaction", [
  { from, to: toQ(contract), data: mintSel + toPad + amtPad, gas, gasPrice },
]);
console.log("mint tx", mintHash);
for (let i = 0; i < 20; i++) {
  const r = await qrlRpc("qrl_getTransactionReceipt", [mintHash]);
  if (r && r.status) break;
  await new Promise((x) => setTimeout(x, 800));
}

const supply = await qrlRpc("qrl_call", [{ to: toQ(contract), data: "0x18160ddd" }, "latest"]);
const held = await qrlRpc("qrl_call", [{ to: toQ(contract), data: "0x70a08231" + toPad }, "latest"]);
const record = {
  network: process.env.QRL_NETWORK || "qrl-qrvm-dev",
  vm: "qrvm",
  standard: "QRC-20",
  addressBytes: 20,
  chainId: Number(await qrlRpc("qrl_chainId", [])),
  rpc: process.env.QRL_RPC,
  usdc: contract,
  usdcQ: toQ(contract),
  deployer: from,
  deployerQ: toQ(from),
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  totalSupply: BigInt(supply).toString(),
  mintedToDeployer: BigInt(held).toString(),
  deployTx: txHash,
  mintTx: mintHash,
  explorerToken: `${EXPLORER}/address/${toQ(contract)}`,
  note: "QRC-20 USDC on QRVM, 20-byte addresses. Not ERC-20.",
};
fs.writeFileSync(path.join(root, "deployments/qrl-testnet.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
