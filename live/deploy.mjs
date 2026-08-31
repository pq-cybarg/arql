#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadOrCreateWallet } from "./wallet.mjs";
import { QRL_RPC, QRL_CHAIN_ID, EXPLORER, toQ } from "./rpc.mjs";

const require = createRequire(import.meta.url);
const { Web3 } = require("@theqrl/web3");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artPath = path.join(root, "live/out/QRC20USDC.json");

if (!fs.existsSync(artPath)) {
  const r = spawnSync(process.execPath, [path.join(root, "live/compile.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

const art = JSON.parse(fs.readFileSync(artPath, "utf8"));
const wallet = loadOrCreateWallet();
const web3 = new Web3(new Web3.providers.HttpProvider(QRL_RPC));
const acc = web3.qrl.accounts.seedToAccount(wallet.hexseed);
web3.qrl.wallet.add(wallet.hexseed);
console.log("deployer", acc.address);

const chainId = await web3.qrl.getChainId();
console.log("chainId", Number(chainId));
if (Number(chainId) !== QRL_CHAIN_ID) {
  throw new Error(`expected chain ${QRL_CHAIN_ID}, got ${chainId}`);
}

const bal = await web3.qrl.getBalance(acc.address);
console.log("balance planck", bal.toString());
if (bal === 0n || bal === 0) {
  throw new Error("deployer has 0 QRL — run node live/faucet.mjs after claiming at https://zondscan.com/faucet");
}

const contract = new web3.qrl.Contract(art.abi);
const deploy = contract.deploy({ data: art.bytecode, arguments: [] });
const estimatedGas = await deploy.estimateGas({ from: acc.address });
const gas = (estimatedGas * 15n) / 10n;
const gasPrice = await web3.qrl.getGasPrice();
console.log("gas", gas.toString(), "gasPrice", gasPrice.toString());

const receipt = await web3.qrl.sendTransaction(
  { gas, gasPrice, from: acc.address, data: deploy.encodeABI() },
  undefined,
  { checkRevertBeforeSending: true },
);
console.log("tx", receipt.transactionHash);
console.log("contract", receipt.contractAddress);

const token = new web3.qrl.Contract(art.abi, receipt.contractAddress);
const mintAmount = 1_000_000_000n; // 1000 USDC
const mint = token.methods.mint(acc.address, mintAmount);
const mintGas = ((await mint.estimateGas({ from: acc.address })) * 15n) / 10n;
const mintReceipt = await mint.send({ from: acc.address, gas: mintGas, gasPrice });
console.log("mint tx", mintReceipt.transactionHash);

const supply = await token.methods.totalSupply().call();
const held = await token.methods.balanceOf(acc.address).call();
const symbol = await token.methods.symbol().call();
const name = await token.methods.name().call();
const decimals = await token.methods.decimals().call();

const qAddr = toQ(receipt.contractAddress);
const record = {
  network: "qrl-testnet-v2",
  vm: "qrvm",
  standard: "QRC-20",
  addressBytes: 20,
  chainId: QRL_CHAIN_ID,
  rpc: QRL_RPC,
  usdc: receipt.contractAddress,
  usdcQ: qAddr,
  deployer: acc.address,
  deployerQ: toQ(acc.address),
  name,
  symbol,
  decimals: Number(decimals),
  totalSupply: supply.toString(),
  mintedToDeployer: held.toString(),
  deployTx: receipt.transactionHash,
  mintTx: mintReceipt.transactionHash,
  explorerToken: `${EXPLORER}/address/${qAddr}`,
  explorerTx: `${EXPLORER}/tx/${receipt.transactionHash}`,
};
fs.writeFileSync(path.join(root, "deployments/qrl-testnet.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
