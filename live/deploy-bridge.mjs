#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getWeb3, loadMeta, send, to0x, toQ } from "./operator.mjs";
import { QRL_RPC, EXPLORER } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artPath = path.join(root, "live/out/ArqlBridge.json");
if (!fs.existsSync(artPath)) {
  const r = spawnSync(process.execPath, [path.join(root, "live/compile-bridge.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const art = JSON.parse(fs.readFileSync(artPath, "utf8"));
const meta = loadMeta();
const { web3, acc } = getWeb3();
const token = toQ(meta.usdcQ || meta.usdc);
console.log("token", token, "from", acc.address);

const contract = new web3.qrl.Contract(art.abi);
const deploy = contract.deploy({ data: art.bytecode, arguments: [token] });
const gasPrice = await web3.qrl.getGasPrice();
let gas = 3_000_000n;
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
const bridgeQ = toQ(receipt.contractAddress);
console.log("bridge", bridgeQ, receipt.transactionHash);

const usdcArt = JSON.parse(fs.readFileSync(path.join(root, "live/out/QRC20USDC.json"), "utf8"));
const usdc = new web3.qrl.Contract(usdcArt.abi, meta.usdcQ);
const setData = usdc.methods.setMinter(bridgeQ).encodeABI();
const setRec = await send(meta.usdcQ, setData, 120000n);
console.log("setMinter", setRec.tx);

meta.bridge = bridgeQ;
meta.bridgeQ = bridgeQ;
meta.bridgeTx = receipt.transactionHash;
meta.minter = bridgeQ;
meta.explorerBridge = `${EXPLORER}/address/${bridgeQ}`;
fs.writeFileSync(path.join(root, "deployments/qrl-testnet.json"), JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ bridge: bridgeQ, setMinter: setRec.tx }, null, 2));
