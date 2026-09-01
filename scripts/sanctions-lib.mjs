import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".data", "sanctions.json");

function norm(a) {
  return String(a || "").trim().toLowerCase().replace(/^0x/, "q");
}

function load() {
  if (!existsSync(file)) return { blocked: [] };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { blocked: [] };
  }
}

function save(st) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(st, null, 2));
}

export function isSanctioned(account) {
  const k = norm(account);
  if (!k) return false;
  return load().blocked.includes(k);
}

export function setSanctioned(account, on) {
  const k = norm(account);
  if (!k) throw new Error("address");
  const st = load();
  const set = new Set(st.blocked);
  if (on) set.add(k);
  else set.delete(k);
  st.blocked = [...set];
  save(st);
  return { account: k, blocked: on, count: st.blocked.length };
}

export function requireClear(account) {
  if (isSanctioned(account)) throw new Error("sanctioned");
}
