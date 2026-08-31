import { toWire64, WIRE_ADDR_BYTES } from "../addresses/index.mjs";

export const VERSION = 2;
export const HEADER_LEN = 244;
export const BURN_FIXED = 324;
export const ARC_DOMAIN = 26;
export const QRL_DOMAIN = 42424;
export const FINALIZED = 2000;

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u256be(n) {
  const v = BigInt(n);
  const b = Buffer.alloc(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function as64(addr) {
  return Buffer.from(toWire64(addr));
}

export function encodeBurnBody({
  burnToken,
  mintRecipient,
  amount,
  messageSender,
  maxFee = 0n,
  feeExecuted = 0n,
  expirationBlock = 0n,
  hookData = new Uint8Array(),
}) {
  return Buffer.concat([
    u32be(VERSION),
    as64(burnToken),
    as64(mintRecipient),
    u256be(amount),
    as64(messageSender),
    u256be(maxFee),
    u256be(feeExecuted),
    u256be(expirationBlock),
    Buffer.from(hookData),
  ]);
}

export function encodeHeader({
  sourceDomain,
  destinationDomain,
  nonce,
  sender,
  recipient,
  destinationCaller = new Uint8Array(64),
  minFinalityThreshold = FINALIZED,
  finalityThresholdExecuted = FINALIZED,
  body,
}) {
  const nonceBuf = Buffer.from(String(nonce).replace(/^0x/, ""), "hex");
  if (nonceBuf.length !== 32) throw new Error("nonce 32 bytes");
  return Buffer.concat([
    u32be(VERSION),
    u32be(sourceDomain),
    u32be(destinationDomain),
    nonceBuf,
    as64(sender),
    as64(recipient),
    destinationCaller.length === 64 ? Buffer.from(destinationCaller) : as64(destinationCaller),
    u32be(minFinalityThreshold),
    u32be(finalityThresholdExecuted),
    Buffer.from(body),
  ]);
}

export function readU32(buf, off) {
  return buf.readUInt32BE(off);
}

export function decodeHeader(buf) {
  const b = Buffer.from(buf);
  if (b.length < HEADER_LEN) throw new Error("hdr");
  return {
    version: readU32(b, 0),
    sourceDomain: readU32(b, 4),
    destinationDomain: readU32(b, 8),
    nonce: "0x" + b.subarray(12, 44).toString("hex"),
    sender: "0x" + b.subarray(44, 108).toString("hex"),
    recipient: "0x" + b.subarray(108, 172).toString("hex"),
    destinationCaller: "0x" + b.subarray(172, 236).toString("hex"),
    minFinalityThreshold: readU32(b, 236),
    finalityThresholdExecuted: readU32(b, 240),
    body: b.subarray(244),
  };
}

export { WIRE_ADDR_BYTES };
