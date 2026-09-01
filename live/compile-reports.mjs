#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hypc = require("@theqrl/hypc");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "contracts/qrl20/ReportBoard.hyp");
const outDir = path.join(root, "live/out");

const input = {
  language: "Hyperion",
  sources: { "ReportBoard.hyp": { content: fs.readFileSync(srcPath, "utf8") } },
  settings: { outputSelection: { "*": { "*": ["*"] } } },
};
const output = JSON.parse(hypc.compile(JSON.stringify(input)));
if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  for (const e of output.errors) console.error(e.formattedMessage || e.message);
  if (fatal.length) process.exit(1);
}
const art = output.contracts["ReportBoard.hyp"].ReportBoard;
fs.mkdirSync(outDir, { recursive: true });
const packed = {
  contract: "ReportBoard",
  abi: art.abi,
  bytecode: "0x" + art.zvm.bytecode.object,
  deployedBytecode: "0x" + (art.zvm.deployedBytecode?.object || art.zvm.bytecode.object),
};
fs.writeFileSync(path.join(outDir, "ReportBoard.json"), JSON.stringify(packed, null, 2));
console.log("compiled ReportBoard", packed.bytecode.length, "bytes hex");
