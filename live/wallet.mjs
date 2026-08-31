#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MLDSA87 } = require("@theqrl/wallet.js");

function loadEnvFile() {
  try {
    const envPath = new URL("../.env", import.meta.url);
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i);
      if (process.env[k] == null) process.env[k] = t.slice(i + 1);
    }
  } catch {
    /* no local env file */
  }
}

function walletFile() {
  loadEnvFile();
  const p = process.env.ARQL_WALLET;
  if (!p) throw new Error("ARQL_WALLET is not set");
  return p;
}

export function loadOrCreateWallet() {
  const dest = walletFile();
  if (fs.existsSync(dest)) {
    return JSON.parse(fs.readFileSync(dest, "utf8"));
  }
  const w = MLDSA87.newWallet();
  const record = {
    address: w.getAddressStr(),
    hexseed: w.getHexExtendedSeed(),
    mnemonic: w.getMnemonic(),
    addressBytes: 20,
    createdAt: new Date().toISOString(),
    note: "QRL 2.0 Testnet V2 Dilithium (ML-DSA-87). Q + 40 hex.",
  };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(record, null, 2), { mode: 0o600 });
  w.zeroize();
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const w = loadOrCreateWallet();
  console.log(w.address);
}
