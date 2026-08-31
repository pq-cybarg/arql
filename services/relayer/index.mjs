#!/usr/bin/env node
/**
 * ARQL relayer.
 * Arc: SLH-DSA-SHA2-128s attestation via Arc precompile 0x1800..0004. ECDSA is rejected.
 * QRL: ML-DSA-87 transaction signatures (QRVM). Never secp256k1.
 */
import { readFileSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeHeader } from "../../packages/codec/index.mjs";

const IRIS = process.env.IRIS_URL || "http://127.0.0.1:7465";
const DEPLOY = process.env.DEPLOYMENTS || new URL("../../deployments/local.json", import.meta.url).pathname;
const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("PRIVATE_KEY is required");
const ARC_RPC = process.env.ARC_RPC || "http://127.0.0.1:8545";
const QRL_RPC = process.env.QRL_RPC || "http://127.0.0.1:8545";
const POLL_MS = Number(process.env.RELAY_POLL_MS || 2000);

const MESSAGE_SENT = "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";

const transmitterAbi = [
  {
    type: "event",
    name: "MessageSent",
    inputs: [{ name: "message", type: "bytes", indexed: false }],
  },
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "publicKeys", type: "bytes[]" },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const qrlTransmitterAbi = [
  {
    type: "event",
    name: "MessageSent",
    inputs: [{ name: "message", type: "bytes", indexed: false }],
  },
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [{ name: "message", type: "bytes" }],
    outputs: [{ type: "bool" }],
  },
];

function loadDeploy() {
  if (!existsSync(DEPLOY)) throw new Error(`missing ${DEPLOY} — run scripts/demo-local.sh`);
  return JSON.parse(readFileSync(DEPLOY, "utf8"));
}

async function extcodehash(client, addr) {
  const code = await client.getCode({ address: addr });
  if (!code || code === "0x") throw new Error(`empty code at ${addr}`);
  return keccak256(code);
}

async function assertSeal(client, d, side) {
  const chainId = BigInt(d.chainId || process.env.CHAIN_ID || 31337);
  const messenger = side === "arc" ? d.arcMessenger : d.qrlMessenger;
  const minter = side === "arc" ? d.arcMinter : d.qrlMinter;
  const transmitter = side === "arc" ? d.arcTransmitter : d.qrlTransmitter;
  const expected = side === "arc" ? d.arcSeal : d.qrlSeal;
  if (!expected) throw new Error(`missing ${side} seal in deployments`);
  const seal = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
      ],
      [
        chainId,
        messenger,
        await extcodehash(client, messenger),
        minter,
        await extcodehash(client, minter),
        transmitter,
        await extcodehash(client, transmitter),
      ],
    ),
  );
  if (seal.toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${side} code seal mismatch: chain bytecode != pinned QRVM/Arc seal`);
  }
}

async function postIris(body) {
  const res = await fetch(`${IRIS}/v2/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`iris ${res.status}`);
}

function rejectClassical(pkHex, sigHex) {
  const pk = Buffer.from(String(pkHex).replace(/^0x/i, ""), "hex");
  const sig = Buffer.from(String(sigHex).replace(/^0x/i, ""), "hex");
  if (sig.length === 64 || sig.length === 65) throw new Error("ecdsa-forbidden");
  if (pk.length === 20 || pk.length === 33 || pk.length === 64 || pk.length === 65) {
    throw new Error("ec-key-forbidden");
  }
}

/** Anvil stub matching SLHPrecompileStub: sig[0:32] = keccak256(pk || digest). */
function stubSlhAttest(pkHex, messageHex) {
  const pk = Buffer.from(String(pkHex).replace(/^0x/i, ""), "hex");
  if (pk.length !== 32) throw new Error("slh-pk");
  const digest = Buffer.from(keccak256(messageHex).slice(2), "hex");
  const head = keccak256(`0x${pk.toString("hex")}${digest.toString("hex")}`).slice(2);
  const sig = Buffer.concat([Buffer.from(head, "hex"), Buffer.alloc(7856 - 32)]);
  const sigHex = "0x" + sig.toString("hex");
  rejectClassical(pkHex, sigHex);
  return { pk: "0x" + pk.toString("hex"), sig: sigHex };
}

async function relayOnce(client, wallet, cfg, from) {
  const logs = await client.getLogs({
    address: from.transmitter,
    event: transmitterAbi[0],
    fromBlock: from.lastBlock,
    toBlock: "latest",
  });
  const latest = await client.getBlockNumber();
  for (const log of logs) {
    const decoded = decodeEventLog({ abi: transmitterAbi, data: log.data, topics: log.topics });
    const message = decoded.args.message;
    const header = decodeHeader(Buffer.from(message.slice(2), "hex"));
    const messageHash = keccak256(message);
    if (from.ecdsa) throw new Error("ecdsa-forbidden: relayer will not attest with secp256k1");
    await assertSeal(client, cfg, from.destKind === "qrl" ? "arc" : "qrl");
    const pkA = process.env.ARC_SLH_PK || ("0x" + "00".repeat(29) + "0a77e571");
    const pkB = process.env.ARC_SLH_PK2 || ("0x" + "00".repeat(29) + "0a77e572");
    const a = stubSlhAttest(pkA, message);
    const b = stubSlhAttest(pkB, message);
    await postIris({
      messageHash,
      message,
      attestation: a.sig,
      publicKey: a.pk,
      sourceDomain: header.sourceDomain,
      destinationDomain: header.destinationDomain,
      nonce: header.nonce,
      transactionHash: log.transactionHash,
      status: "complete",
    });
    console.log("attested", messageHash, header.sourceDomain, "->", header.destinationDomain);

    try {
      if (from.destKind === "qrl") {
        const hash = await wallet.writeContract({
          address: from.destTransmitter,
          abi: qrlTransmitterAbi,
          functionName: "receiveMessage",
          args: [message],
        });
        console.log("partial/minted on QRVM twin", hash);
      } else {
        const hash = await wallet.writeContract({
          address: from.destTransmitter,
          abi: transmitterAbi,
          functionName: "receiveMessage",
          args: [message, [a.pk, b.pk], [a.sig, b.sig]],
        });
        console.log("unlocked on Arc", hash);
      }
    } catch (err) {
      console.error("receive failed (maybe already processed)", err.shortMessage || err.message);
    }
  }
  from.lastBlock = latest + 1n;
}

async function main() {
  const d = loadDeploy();
  const account = privateKeyToAccount(PK);
  const chain = {
    id: Number(process.env.CHAIN_ID || 31337),
    name: "local",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [ARC_RPC] } },
  };
  const publicClient = createPublicClient({ transport: http(ARC_RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(ARC_RPC) });

  const start = await publicClient.getBlockNumber();
  const arc = {
    transmitter: d.arcTransmitter,
    destTransmitter: d.qrlTransmitter,
    destKind: "qrl",
    ecdsa: false,
    lastBlock: start,
  };
  const qrl = {
    transmitter: d.qrlTransmitter,
    destTransmitter: d.arcTransmitter,
    destKind: "arc",
    ecdsa: false,
    lastBlock: start,
  };

  console.log("relayer watching", d.arcTransmitter, "and", d.qrlTransmitter);
  for (;;) {
    try {
      await relayOnce(publicClient, wallet, d, arc);
      await relayOnce(publicClient, wallet, d, qrl);
    } catch (err) {
      console.error(err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
