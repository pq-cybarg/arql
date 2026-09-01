import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".data", "faucet.json");

// Circle Arc faucet: 20 USDC per address per 2 hours.
export const OFFICIAL_CLAIM = 20;
export const DAILY_TOTAL = 9; // < half of 20
export const PER_ACCOUNT = 2;

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function load() {
  if (!existsSync(file)) return { day: utcDay(), total: 0, accounts: {} };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { day: utcDay(), total: 0, accounts: {} };
  }
}

function save(st) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(st, null, 2));
}

function roll(st) {
  const day = utcDay();
  if (st.day !== day) return { day, total: 0, accounts: {} };
  return st;
}

export function faucetCheck(account) {
  const key = String(account || "").toLowerCase();
  if (!key) throw new Error("connect a wallet first");
  const st = roll(load());
  const used = Number(st.accounts[key] || 0);
  if (used >= PER_ACCOUNT) throw new Error(`this address already claimed ${used} USDC today (cap ${PER_ACCOUNT})`);
  if (st.total + PER_ACCOUNT > DAILY_TOTAL) {
    throw new Error(`daily faucet empty (${st.total}/${DAILY_TOTAL} USDC). try tomorrow`);
  }
  return { st, key, amount: PER_ACCOUNT };
}

export function faucetCommit(st, key, amount) {
  st.accounts[key] = Number(st.accounts[key] || 0) + amount;
  st.total += amount;
  save(st);
  return { given: amount, accountToday: st.accounts[key], dayTotal: st.total, dayCap: DAILY_TOTAL };
}

export function faucetStatus() {
  const st = roll(load());
  return {
    perAccount: PER_ACCOUNT,
    dailyTotal: DAILY_TOTAL,
    officialClaim: OFFICIAL_CLAIM,
    usedToday: st.total,
    remainingToday: Math.max(0, DAILY_TOTAL - st.total),
    day: st.day,
  };
}
