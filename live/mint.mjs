#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadOrCreateWallet } from "./wallet.mjs";
import { QRL_RPC, EXPLORER, toQ, qrlRpc } from "./rpc.mjs";

const require = createRequire(import.meta.url);
const { Web3 } = require("@theqrl/web3");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const recPath = path.join(root, "deployments/qrl-testnet.json");
const art = JSON.parse(fs.readFileSync(path.join(root, "live/out/QRC20USDC.json"), "utf8"));

const contractQ = process.argv[2] || (fs.existsSync(recPath) && JSON.parse(fs.readFileSync(recPath, "utf8")).usdcQ);
if (!contractQ) throw new Error("pass contract Q-address or write deployments/qrl-testnet.json");

const wallet = loadOrCreateWallet();
const web3 = new Web3(new Web3.providers.HttpProvider(QRL_RPC));
const acc = web3.qrl.accounts.seedToAccount(wallet.hexseed);
web3.qrl.wallet.add(wallet.hexseed);

const amount = 1_000_000_000n;
const token = new web3.qrl.Contract(art.abi, contractQ);
const data = token.methods.mint(acc.address, amount).encodeABI();
const gasPrice = await web3.qrl.getGasPrice();
let gas = 300000n;
try {
  gas = (BigInt(await qrlRpc("qrl_estimateGas", [{ from: acc.address, to: toQ(contractQ), data }])) * 15n) / 10n;
} catch {
  /* public RPC may block estimateGas */
}

console.log("mint from", acc.address, "to", toQ(contractQ), "gas", gas.toString());
const receipt = await web3.qrl.sendTransaction(
  { from: acc.address, to: toQ(contractQ), data, gas, gasPrice },
  undefined,
  { checkRevertBeforeSending: false },
);
console.log("mint tx", receipt.transactionHash);

const supply = await token.methods.totalSupply().call();
const held = await token.methods.balanceOf(acc.address).call();
const record = {
  network: "qrl-testnet-v2",
  vm: "qrvm",
  standard: "QRC-20",
  addressBytes: 20,
  chainId: 1337,
  rpc: QRL_RPC,
  usdc: toQ(contractQ),
  usdcQ: toQ(contractQ),
  deployer: acc.address,
  deployerQ: toQ(acc.address),
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
  totalSupply: supply.toString(),
  mintedToDeployer: held.toString(),
  deployTx: fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, "utf8")).deployTx : undefined,
  mintTx: receipt.transactionHash,
  explorerToken: `${EXPLORER}/address/${toQ(contractQ)}`,
  explorerTx: `${EXPLORER}/tx/${receipt.transactionHash}`,
  note: "QRC-20 USDC on public QRL 2.0 Testnet V2 (20-byte Q addresses). Not ERC-20.",
};
fs.writeFileSync(recPath, JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
