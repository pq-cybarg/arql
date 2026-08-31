#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createWalletClient, http, parseAbi, keccak256, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mintRecipientBytes, zeroCaller, FINALIZED, depositCalldata } from "../packages/sdk/index.mjs";

const d = JSON.parse(readFileSync(new URL("../deployments/local.json", import.meta.url), "utf8"));
const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("PRIVATE_KEY is required");
const rpc = process.env.ARC_RPC || "http://127.0.0.1:8545";
const account = privateKeyToAccount(PK);
const chain = {
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
};
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const amount = 5_000_000n;
const dest = 42424;
const mintTo = mintRecipientBytes(account.address);
const slhPk = d.ownerPk || "0x" + "00".repeat(30) + "051d5a87";

const action = keccak256(
  encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint32" },
      { type: "bytes32" },
      { type: "address" },
      { type: "uint256" },
    ],
    [d.arcMessenger, account.address, amount, dest, keccak256(mintTo), d.arcUsdc, 31337n],
  ),
);
const head = keccak256((slhPk + action.slice(2)));
const pqSig = head + "00".repeat(7856 - 32);

const erc20 = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

await wallet.writeContract({
  address: d.arcUsdc,
  abi: erc20,
  functionName: "approve",
  args: [d.arcMessenger, amount],
});
const data = depositCalldata({
  amount,
  destinationDomain: dest,
  mintRecipient: account.address,
  burnToken: d.arcUsdc,
  pqPk: slhPk,
  pqSig,
});
const hash = await wallet.sendTransaction({ to: d.arcMessenger, data });
console.log("deposit", hash);
console.log("relayer should mint on", d.qrlUsdc);
