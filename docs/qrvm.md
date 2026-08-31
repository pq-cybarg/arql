# QRVM notes

QRL 2.0 is not an EVM chain. The QRVM runs Hyperion (`.hyp`). Transaction
signatures are ML-DSA-87. RPC methods are `qrl_*`. Addresses display as `Q` +
hex and are mid-migration from 20 bytes to 64 bytes (network reset). Word size
and ABI slots are moving to VM64 (`Panic(uint512)` in go-qrl, 21 Aug 2026).

ARQL keeps a packed 64-byte address wire so both widths work. Hyperion sources
are only under `contracts/qrl/*.hyp`. See that directory’s README.
