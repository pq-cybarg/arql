import { encodeFunctionData, parseAbi, pad } from "viem";
import { toWire64, formatAddress, fromWire64 } from "../addresses/index.mjs";
import { ARC_DOMAIN, QRL_DOMAIN, FINALIZED } from "../codec/index.mjs";

export const messengerAbi = parseAbi([
  "function depositForBurn(uint256 amount,uint32 destinationDomain,bytes mintRecipient,address burnToken,bytes destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes pqPk,bytes pqSig) returns (bytes32)",
  "function remoteTokenMessengers(uint32) view returns (bytes)",
  "event DepositForBurn(uint256 amount,uint32 indexed destinationDomain,bytes mintRecipient,address indexed burnToken,bytes destinationCaller,address indexed depositor,bytes32 nonce)",
]);

export const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

export function mintRecipientBytes(address) {
  return "0x" + Buffer.from(toWire64(address)).toString("hex");
}

export function zeroCaller() {
  return "0x" + "00".repeat(64);
}

export function depositCalldata({ amount, destinationDomain, mintRecipient, burnToken, maxFee = 0n, pqPk, pqSig }) {
  if (!pqPk || !pqSig) throw new Error("ecdsa-forbidden: SLH-DSA-SHA2-128s pqPk/pqSig required");
  const pk = Buffer.from(String(pqPk).replace(/^0x/i, ""), "hex");
  const sig = Buffer.from(String(pqSig).replace(/^0x/i, ""), "hex");
  if (sig.length === 64 || sig.length === 65) throw new Error("ecdsa-forbidden");
  if (pk.length !== 32 || sig.length !== 7856) throw new Error("slh-dsa-sha2-128s required");
  return encodeFunctionData({
    abi: messengerAbi,
    functionName: "depositForBurn",
    args: [
      amount,
      destinationDomain,
      mintRecipientBytes(mintRecipient),
      burnToken,
      zeroCaller(),
      maxFee,
      FINALIZED,
      pqPk,
      pqSig,
    ],
  });
}

export { ARC_DOMAIN, QRL_DOMAIN, FINALIZED, toWire64, fromWire64, formatAddress };
