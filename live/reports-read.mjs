import { qrlRpc, toQ } from "./rpc.mjs";

function word(h, o) {
  return h.slice(o, o + 64);
}
function addr(h, o) {
  return "Q" + word(h, o).slice(24);
}

export async function loadReports(board, max = 32) {
  if (!board) return { count: 0, items: [] };
  const to = toQ(board);
  const nHex = await qrlRpc("qrl_call", [{ to, data: "0x06661abd" }, "latest"]);
  const n = BigInt(nHex);
  const items = [];
  const start = n > BigInt(max) ? n - BigInt(max) : 0n;
  for (let i = n; i > start; ) {
    i -= 1n;
    const raw = await qrlRpc("qrl_call", [
      { to, data: "0xc942adf7" + i.toString(16).padStart(64, "0") },
      "latest",
    ]);
    const h = String(raw).replace(/^0x/i, "").padStart(320, "0");
    items.push({
      id: Number(i),
      reporter: addr(h, 0),
      subject: addr(h, 64),
      tag: "0x" + word(h, 128),
      paidQrl: Number(BigInt("0x" + word(h, 192))) / 1e18,
      atBlock: Number(BigInt("0x" + word(h, 256))),
    });
  }
  return { count: Number(n), items };
}
