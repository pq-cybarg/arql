#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getWeb3, loadMeta, send, toQ } from "./operator.mjs";
import { EXPLORER } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artPath = path.join(root, "live/out/UsdcFaucet.json");
if (!fs.existsSync(artPath)) {
  const r = spawnSync(process.execPath, [path.join(root, "live/compile-faucet.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const art = JSON.parse(fs.readFileSync(artPath, "utf8"));
const meta = loadMeta();
const { web3, acc } = getWeb3();
const token = toQ(meta.usdcQ || meta.usdc);
const fund = 100n * 10n ** 6n;

const contract = new web3.qrl.Contract(art.abi);
const deploy = contract.deploy({ data: art.bytecode, arguments: [token] });
const gasPrice = await web3.qrl.getGasPrice();
let gas = 1_500_000n;
try {
  gas = (BigInt(await deploy.estimateGas({ from: acc.address })) * 15n) / 10n;
} catch {
  /* ignore */
}
const receipt = await web3.qrl.sendTransaction(
  { from: acc.address, data: deploy.encodeABI(), gas, gasPrice },
  undefined,
  { checkRevertBeforeSending: false },
);
const faucetQ = toQ(receipt.contractAddress);
console.log("faucet", faucetQ, receipt.transactionHash);

const usdcArt = JSON.parse(fs.readFileSync(path.join(root, "live/out/QRC20USDC.json"), "utf8"));
const usdc = new web3.qrl.Contract(usdcArt.abi, token);
await send(token, usdc.methods.transfer(faucetQ, fund.toString()).encodeABI(), 80000n);
console.log("funded", fund.toString(), "base units");

const metaPath = path.join(root, "deployments/qrl-testnet.json");
meta.faucetQ = faucetQ;
meta.faucetTx = receipt.transactionHash;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
console.log("explorer", `${EXPLORER}/address/${faucetQ}`);
