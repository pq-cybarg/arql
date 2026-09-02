import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonQ,
  findTokenBalance,
  rawToDisplay,
  inventoryFromZond,
  zondNonceHex,
  userUsdcDisplay,
  shortAddr,
  hexQty,
} from "../../apps/web/chain.js";

test("canonQ normalizes 0x and Q addresses", () => {
  assert.equal(canonQ("Qadf94bb6e061a9f3b1d54826241eba701d43fb86"), "Qadf94bb6e061a9f3b1d54826241eba701d43fb86");
  assert.equal(canonQ("0xAdf94bb6e061a9f3b1d54826241eba701d43fb86"), "Qadf94bb6e061a9f3b1d54826241eba701d43fb86");
});

test("findTokenBalance picks the live USDC contract, not the previous one", () => {
  const live = "Qadf94bb6e061a9f3b1d54826241eba701d43fb86";
  const old = "Q34ab8332f1f46cd6bf42118b6ed8c5208d6c9af9";
  const resp = {
    tokens: [
      { contractAddress: old, balance: "930000000", decimals: 6, symbol: "USDC" },
      { contractAddress: live, balance: "900000000", decimals: 6, symbol: "USDC" },
    ],
  };
  assert.equal(findTokenBalance(resp, live).raw, "900000000");
  assert.equal(findTokenBalance(resp, old).raw, "930000000");
  assert.equal(findTokenBalance(resp, "Qdead"), null);
});

test("rawToDisplay formats 6-decimal USDC", () => {
  assert.equal(rawToDisplay("900000000", 6), "900");
  assert.equal(rawToDisplay("100000000", 6), "100");
  assert.equal(rawToDisplay("0", 6), "0");
});

test("inventoryFromZond uses faucet remaining for the user-facing pool", () => {
  const cfg = {
    usdcQ: "Qadf94bb6e061a9f3b1d54826241eba701d43fb86",
    holderQ: "Q34cd38c76995e150ec583ff558cad07e08daad75",
    faucetQ: "Qfae14bd34a31d3928f869ca9ccab417ce4921882",
    decimals: 6,
  };
  const inv = inventoryFromZond(cfg, {
    holderTokens: {
      tokens: [{ contractAddress: cfg.usdcQ, balance: "900000000", decimals: 6 }],
    },
    faucetTokens: {
      tokens: [{ contractAddress: cfg.usdcQ, balance: "100000000", decimals: 6 }],
    },
    latest: { blockNumber: 221426 },
    holderAgg: { address: { balance: 9.97 } },
  });
  assert.equal(inv.held, "900");
  assert.equal(inv.faucetHeld, "100");
  assert.equal(inv.pool, "100");
  assert.equal(inv.block, 221426);
  assert.equal(inv.qrl, 9.97);
});

test("hexQty is even-length 0x for QRL web3 validators", () => {
  assert.equal(hexQty(0), "0x00");
  assert.equal(hexQty(14), "0x0e");
  assert.equal(hexQty("0x40000"), "0x040000");
  assert.equal(hexQty(1337), "0x0539");
});

test("zondNonceHex reads aggregate nonce", () => {
  assert.equal(zondNonceHex({ address: { nonce: 14 } }), "0x0e");
  assert.equal(zondNonceHex({ nonce: 0 }), "0x00");
});

test("shortAddr keeps Q prefix and clips the middle", () => {
  assert.equal(shortAddr("Qadf94bb6e061a9f3b1d54826241eba701d43fb86"), "Qadf94...fb86");
  assert.equal(shortAddr(""), "");
});

test("userUsdcDisplay is 0 when the live token is missing from the list", () => {
  const live = "Qadf94bb6e061a9f3b1d54826241eba701d43fb86";
  assert.equal(userUsdcDisplay({ tokens: [] }, live), "0");
  assert.equal(
    userUsdcDisplay({ tokens: [{ contractAddress: live, balance: "2000000", decimals: 6 }] }, live),
    "2",
  );
});
