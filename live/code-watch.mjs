import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { qrlRpc, toQ } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadExpected(file) {
  const p = path.join(root, "live/out", file);
  if (!fs.existsSync(p)) return null;
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  const hex = art.deployedBytecode || art.bytecode;
  if (!hex || hex === "0x") return null;
  return keccak256(hex);
}

export async function watchOnChainCode(cfg = {}) {
  const configPath = path.join(root, "apps/web/config.json");
  const published = JSON.parse(fs.readFileSync(configPath, "utf8"));
  cfg = { ...published, ...cfg };
  const jobs = [
    { name: "QRC-20 USDC", address: cfg.usdcQ, artifact: "QRC20USDC.json" },
    { name: "bridge (minter)", address: cfg.bridgeQ, artifact: "ArqlBridge.json" },
    { name: "sealed bridge", address: cfg.sealedBridge, artifact: "ArqlBridge.json" },
    { name: "report board", address: cfg.reportBoardQ, artifact: "ReportBoard.json" },
  ].filter((j) => j.address);

  const alarms = [];
  const checks = [];
  for (const job of jobs) {
    const pin = (cfg.pinnedCodehash || {})[toQ(job.address).toLowerCase()]
      || (cfg.pinnedCodehash || {})[toQ(job.address)];
    const expected = pin || loadExpected(job.artifact);
    let liveCode = "0x";
    try {
      liveCode = await qrlRpc("qrl_getCode", [toQ(job.address), "latest"]);
    } catch (err) {
      alarms.push({ ...job, reason: "rpc-failed", detail: String(err.message || err) });
      continue;
    }
    const empty = !liveCode || liveCode === "0x";
    const liveHash = empty ? "0x" : keccak256(liveCode);
    const row = {
      name: job.name,
      address: toQ(job.address),
      expected,
      live: liveHash,
      ok: !empty && expected && liveHash.toLowerCase() === expected.toLowerCase(),
    };
    checks.push(row);
    if (empty) alarms.push({ ...row, reason: "empty-code" });
    else if (!expected) alarms.push({ ...row, reason: "unpinned" });
    else if (!row.ok) alarms.push({ ...row, reason: "hash-mismatch" });
  }
  return { ok: alarms.length === 0, alarms, checks };
}
