#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getWeb3, loadMeta, toQ } from "./operator.mjs";
import { EXPLORER } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artPath = path.join(root, "live/out/ReportBoard.json");
if (!fs.existsSync(artPath)) {
  const r = spawnSync(process.execPath, [path.join(root, "live/compile-reports.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
const art = JSON.parse(fs.readFileSync(artPath, "utf8"));
const { web3, acc } = getWeb3();
const minFee = 10n ** 16n; // 0.01 QRL
const contract = new web3.qrl.Contract(art.abi);
const deploy = contract.deploy({ data: art.bytecode, arguments: [minFee.toString()] });
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
const boardQ = toQ(receipt.contractAddress);
console.log("reportBoard", boardQ, receipt.transactionHash);
const metaPath = path.join(root, "deployments/qrl-testnet.json");
const meta = loadMeta();
meta.reportBoardQ = boardQ;
meta.reportBoardTx = receipt.transactionHash;
meta.reportMinFee = minFee.toString();
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
console.log("explorer", `${EXPLORER}/address/${boardQ}`);
