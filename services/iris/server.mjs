#!/usr/bin/env node
/**
 * Iris-shaped attestation API for ARQL.
 * Circle's iris-api-sandbox will not attest unofficial domain 42424 (QRL).
 * This service is the local equivalent: GET /v2/messages, GET /v2/attestations/:hash
 */
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.IRIS_PORT || 7465);
const STORE = process.env.IRIS_STORE || join(__dirname, "../../deployments/iris-store.json");

function load() {
  if (!existsSync(STORE)) return { messages: [] };
  return JSON.parse(readFileSync(STORE, "utf8"));
}

function save(db) {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(db, null, 2));
}

function keccakHex(hex) {
  // Hash is keccak256 of the message bytes; we store it from the relayer.
  return hex;
}

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const db = load();

  if (req.method === "POST" && url.pathname === "/v2/messages") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const msg = JSON.parse(raw || "{}");
      if (!msg.messageHash || !msg.message) {
        return json(res, 400, { error: "messageHash and message required" });
      }
      const existing = db.messages.find((m) => m.messageHash === msg.messageHash);
      if (existing) Object.assign(existing, msg);
      else db.messages.push({ ...msg, status: msg.status || "complete", createdAt: Date.now() });
      save(db);
      json(res, 200, { data: msg });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v2/messages") {
    const tx = url.searchParams.get("transactionHash");
    const domain = url.searchParams.get("sourceDomain");
    let rows = db.messages;
    if (tx) rows = rows.filter((m) => (m.transactionHash || "").toLowerCase() === tx.toLowerCase());
    if (domain) rows = rows.filter((m) => String(m.sourceDomain) === String(domain));
    return json(res, 200, { messages: rows });
  }

  const att = url.pathname.match(/^\/v2\/attestations\/(.+)$/);
  if (req.method === "GET" && att) {
    const hash = att[1].startsWith("0x") ? att[1] : "0x" + att[1];
    const row = db.messages.find((m) => m.messageHash.toLowerCase() === hash.toLowerCase());
    if (!row) return json(res, 404, { status: "pending" });
    return json(res, 200, {
      status: row.status || "complete",
      attestation: row.attestation || null,
      message: row.message,
      messageHash: row.messageHash,
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, count: db.messages.length });
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`ARQL iris http://127.0.0.1:${PORT}`);
});
