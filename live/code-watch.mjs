import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, toBytes } from "viem";
import { qrlRpc, toQ } from "./rpc.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function fileHash(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return null;
  return keccak256(toHex(toBytes(fs.readFileSync(p))));
}

function artifactHash(file) {
  const p = path.join(root, "live/out", file);
  if (!fs.existsSync(p)) return null;
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  const hex = art.deployedBytecode || art.bytecode;
  if (!hex || hex === "0x") return null;
  return keccak256(hex);
}

function pinFor(cfg, address) {
  const q = toQ(address);
  const pins = cfg.pinnedCodehash || {};
  return pins[q] || pins[q.toLowerCase()] || null;
}

function alarm(row, reason) {
  return { ...row, ok: false, reason };
}

export async function watchOnChainCode(cfg = {}) {
  const published = JSON.parse(fs.readFileSync(path.join(root, "apps/web/config.json"), "utf8"));
  cfg = { ...published, ...cfg };

  const jobs = [
    { name: "QRC-20 USDC", address: cfg.usdcQ, artifact: "QRC20USDC.json", source: "contracts/qrl20/QRC20USDC.hyp" },
    { name: "bridge (minter)", address: cfg.bridgeQ, artifact: "ArqlBridge.json", source: "contracts/qrl20/ArqlBridge.hyp" },
    { name: "sealed bridge", address: cfg.sealedBridge, artifact: "ArqlBridge.json", source: "contracts/qrl20/ArqlBridge.hyp" },
    { name: "report board", address: cfg.reportBoardQ, artifact: "ReportBoard.json", source: "contracts/qrl20/ReportBoard.hyp" },
  ].filter((j) => j.address);

  const alarms = [];
  const checks = [];
  const sourcePins = cfg.pinnedSource || {};

  for (const job of jobs) {
    const pin = pinFor(cfg, job.address);
    const build = artifactHash(job.artifact);
    const source = fileHash(job.source);
    const sourcePin = sourcePins[job.source];
    let liveCode = "0x";
    try {
      liveCode = await qrlRpc("qrl_getCode", [toQ(job.address), "latest"]);
    } catch (err) {
      alarms.push(alarm({ name: job.name, address: toQ(job.address) }, "rpc-failed"));
      continue;
    }
    const empty = !liveCode || liveCode === "0x";
    const live = empty ? "0x" : keccak256(liveCode);
    const row = {
      name: job.name,
      address: toQ(job.address),
      pin,
      build,
      live,
      source,
      sourcePin,
    };
    checks.push(row);
    if (empty) alarms.push(alarm(row, "empty-code"));
    if (pin && live !== "0x" && live.toLowerCase() !== pin.toLowerCase()) {
      alarms.push(alarm(row, "live-vs-pin"));
    }
    if (build && live !== "0x" && live.toLowerCase() !== build.toLowerCase()) {
      alarms.push(alarm(row, "live-vs-build"));
    }
    if (pin && build && pin.toLowerCase() !== build.toLowerCase()) {
      alarms.push(alarm(row, "pin-vs-build"));
    }
    if (source && sourcePin && source.toLowerCase() !== sourcePin.toLowerCase()) {
      alarms.push(alarm(row, "source-changed"));
    }
    if (!pin && !build) alarms.push(alarm(row, "unpinned"));
  }

  for (const [rel, sourcePin] of Object.entries(sourcePins)) {
    if (jobs.some((j) => j.source === rel)) continue;
    const source = fileHash(rel);
    if (source && sourcePin && source.toLowerCase() !== sourcePin.toLowerCase()) {
      alarms.push(alarm({ name: rel, source, sourcePin }, "source-changed"));
    }
  }

  return { ok: alarms.length === 0, alarms, checks };
}
