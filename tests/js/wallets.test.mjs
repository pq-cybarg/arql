import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isQrlInfo,
  injectedWalletName,
  collectEvmWallets,
  pickQrlProvider,
  shouldSkipLiveApi,
  walletRpcUrl,
  findWallet,
  REQUEST_PROVIDER,
  ANNOUNCE_PROVIDER,
  detectedWalletLabel,
} from "../../apps/web/wallets.js";

test("QRL and Zond announcements are not Arc wallets", () => {
  assert.equal(isQrlInfo({ name: "QRL Wallet", rdns: "io.theqrl.wallet" }, {}), true);
  assert.equal(isQrlInfo({ name: "MetaMask", rdns: "io.metamask" }, {}), false);
  assert.equal(isQrlInfo({}, { isQrlWallet: true }), true);
});

test("Brave is named before MetaMask because Brave sets both flags", () => {
  assert.equal(injectedWalletName({ isMetaMask: true, isBraveWallet: true }), "Brave Wallet");
  assert.equal(injectedWalletName({ isMetaMask: true }), "MetaMask (injected)");
  assert.equal(injectedWalletName({ isRabby: true }), "Rabby");
});

test("collectEvmWallets drops QRL and adds injected only when it is a new EVM provider", () => {
  const mm = { request() {} };
  const qrl = { isQrlWallet: true, request() {} };
  const announced = new Map([
    ["qrl", { info: { uuid: "qrl", name: "QRL Wallet", rdns: "io.theqrl.wallet" }, provider: qrl }],
    ["mm", { info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider: mm }],
  ]);
  const listed = collectEvmWallets(announced, mm);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].info.uuid, "mm");
  assert.equal(listed[0].info.name, "MetaMask");

  const extra = { isRabby: true, request() {} };
  const withInjected = collectEvmWallets(announced, extra);
  assert.equal(withInjected.length, 2);
  assert.equal(withInjected[1].info.uuid, "injected-ethereum");
  assert.equal(withInjected[1].info.name, "Rabby");
});

test("injected QRL window.ethereum is not added to the Arc list", () => {
  const announced = new Map();
  const listed = collectEvmWallets(announced, { isQrlWallet: true });
  assert.equal(listed.length, 0);
});

test("pickQrlProvider prefers announced QRL then window.qrl", () => {
  const qrl = { isQrlWallet: true };
  const fake = { isQrlWallet: true };
  const announced = new Map([
    ["mm", { info: { uuid: "mm", name: "MetaMask", rdns: "io.metamask" }, provider: {} }],
    ["fake", { info: { uuid: "fake", name: "QRL Wallet", rdns: "io.evil.qrl" }, provider: fake }],
    ["qrl", { info: { uuid: "qrl", name: "QRL Wallet", rdns: "io.theqrl.wallet" }, provider: qrl }],
  ]);
  assert.equal(pickQrlProvider(announced, {}), qrl);
  assert.equal(pickQrlProvider(new Map(), { qrl: { id: 1 } }).id, 1);
  assert.equal(pickQrlProvider(new Map(), { zond: { id: 2 } }).id, 2);
  assert.equal(pickQrlProvider(new Map(), {}), null);
});

test("GitHub Pages skips the live desk /api/state", () => {
  assert.equal(shouldSkipLiveApi("pq-cybarg.github.io"), true);
  assert.equal(shouldSkipLiveApi("localhost"), false);
  assert.equal(shouldSkipLiveApi("127.0.0.1"), false);
});

test("local desk uses same-origin RPC proxy; Pages keeps the public HTTPS RPC", () => {
  assert.equal(
    walletRpcUrl({ hostname: "127.0.0.1", origin: "http://127.0.0.1:7470" }, "https://qrlwallet.com/api/qrl-rpc/testnet"),
    "http://127.0.0.1:7470/api/qrl-rpc",
  );
  assert.equal(
    walletRpcUrl({ hostname: "pq-cybarg.github.io", origin: "https://pq-cybarg.github.io" }, "https://qrlwallet.com/api/qrl-rpc/testnet"),
    "https://qrlwallet.com/api/qrl-rpc/testnet",
  );
});

test("findWallet looks up synthetic injected uuid outside the announce map", () => {
  const extra = { isRabby: true };
  const wallets = collectEvmWallets(new Map(), extra);
  const hit = findWallet(wallets, new Map(), "injected-ethereum");
  assert.equal(hit.provider, extra);
});

test("detectedWalletLabel does not overwrite a connected account", () => {
  assert.equal(detectedWalletLabel(true, true), "");
  assert.match(detectedWalletLabel(true, false), /Click Connect/);
  assert.equal(detectedWalletLabel(false, false), "Not connected");
});

test("EIP-6963 request/announce event names match the spec", () => {
  assert.equal(REQUEST_PROVIDER, "eip6963:requestProvider");
  assert.equal(ANNOUNCE_PROVIDER, "eip6963:announceProvider");
});
