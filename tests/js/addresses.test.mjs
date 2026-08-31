import { test } from "node:test";
import assert from "node:assert/strict";
import { toWire64, fromWire64, formatAddress, hexToBytes } from "../../packages/addresses/index.mjs";
import { encodeBurnBody, encodeHeader, decodeHeader, VERSION, ARC_DOMAIN, QRL_DOMAIN } from "../../packages/codec/index.mjs";

test("20-byte Arc address left-pads to 64", () => {
  const w = toWire64("0x00000000000000000000000000000000000a11ce");
  assert.equal(w.length, 64);
  assert.equal(Buffer.from(w.subarray(0, 44)).toString("hex"), "00".repeat(44));
  const back = fromWire64(w);
  assert.equal(back.length, 20);
  assert.equal(formatAddress(back, "arc"), "0x00000000000000000000000000000000000a11ce");
});

test("Q-prefix 20-byte QRL address accepted", () => {
  const w = toWire64("Q00000000000000000000000000000000000b0b00");
  assert.equal(fromWire64(w).length, 20);
});

test("64-byte QRL address stays 64 on the wire", () => {
  const hex = "11".repeat(64);
  const w = toWire64("Q" + hex);
  assert.equal(w.length, 64);
  assert.equal(Buffer.from(w).toString("hex"), hex);
  assert.throws(() => fromWire64(w), /wide-addr/);
  const full = fromWire64(w, { allowWide: true });
  assert.equal(full.length, 64);
});

test("burn body + header round-trip", () => {
  const body = encodeBurnBody({
    burnToken: "0x3600000000000000000000000000000000000000",
    mintRecipient: "0x00000000000000000000000000000000000b0b00",
    amount: 5_000_000n,
    messageSender: "0x00000000000000000000000000000000000a11ce",
  });
  const nonce = Buffer.alloc(32, 7);
  const header = encodeHeader({
    sourceDomain: ARC_DOMAIN,
    destinationDomain: QRL_DOMAIN,
    nonce: "0x" + nonce.toString("hex"),
    sender: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    body,
  });
  const d = decodeHeader(header);
  assert.equal(d.version, VERSION);
  assert.equal(d.sourceDomain, ARC_DOMAIN);
  assert.equal(d.destinationDomain, QRL_DOMAIN);
  assert.equal(d.body.length, body.length);
});
