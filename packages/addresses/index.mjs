/** QRL/Arc address codec. Wire format is always 64 bytes. */

export const WIRE_ADDR_BYTES = 64;

export function stripPrefix(value) {
  const s = String(value).trim();
  if (s.startsWith("Q") || s.startsWith("q")) return s.slice(1);
  if (s.startsWith("0x") || s.startsWith("0X")) return s.slice(2);
  return s;
}

export function hexToBytes(hex) {
  const h = stripPrefix(hex).toLowerCase();
  if (h.length % 2 !== 0) throw new Error("odd hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes, prefix = "0x") {
  return prefix + Buffer.from(bytes).toString("hex");
}

/** Display form: 0x… on Arc (EVM), Q… on QRL (QRVM). Never 0x for QRL. */
export function formatAddress(bytesOrHex, chain) {
  const b = typeof bytesOrHex === "string" ? hexToBytes(bytesOrHex) : bytesOrHex;
  const hex = Buffer.from(b).toString("hex");
  if (chain === "qrl") return "Q" + hex;
  return "0x" + hex;
}

/**
 * Pack a 20-byte or 64-byte address into a 64-byte wire field (left-padded).
 * During the QRL 64-byte transition both widths are valid inputs.
 */
export function toWire64(address) {
  const b = hexToBytes(address);
  if (b.length !== 20 && b.length !== 64) {
    throw new Error(`address must be 20 or 64 bytes, got ${b.length}`);
  }
  if (b.length === 64) return b;
  const out = new Uint8Array(64);
  out.set(b, 44);
  return out;
}

/** Unpack a 64-byte wire field. If high 44 bytes are zero, return 20-byte address. */
export function fromWire64(field, { allowWide = false } = {}) {
  const b = field instanceof Uint8Array ? field : hexToBytes(field);
  if (b.length !== 64) throw new Error("wire address must be 64 bytes");
  const high = b.subarray(0, 44);
  const wide = high.some((x) => x !== 0);
  if (wide) {
    if (!allowWide) throw new Error("wide-addr: 64-byte QRL address cannot be an Arc EVM address");
    return b;
  }
  return b.subarray(44);
}

export function detectAddressBytes() {
  const n = Number(process.env.QRL_ADDRESS_BYTES || "20");
  if (n !== 20 && n !== 64) throw new Error("QRL_ADDRESS_BYTES must be 20 or 64");
  return n;
}
