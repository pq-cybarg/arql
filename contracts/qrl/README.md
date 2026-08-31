# QRVM / Hyperion contracts

QRL 2.0 does not run the EVM. It runs the **QRVM**, a fork of the EVM that
executes **Hyperion** (Solidity-shaped, fewer features). Accounts are signed
with **ML-DSA-87**, not secp256k1. Addresses are `Q` + hex, currently 20 bytes
(`Q` + 40 hex) on the public Testnet V2 explorer, mid-migration to **64 bytes**
(`Q` + 128 hex, SHAKE256 checksum). The weekly of 21 Aug 2026 shows web3.js
ABI coding moving to VM64 (`Panic(uint512)`, 64-byte storage slots).

## What you compile with

| File | Compiler | Chain |
| --- | --- | --- |
| `IQRC20.hyp` | QRC-20 token interface |
| `QRC20USDC.hyp` | QRC-20 USD Coin (64-byte-ready Hyperion) |
| `../qrl20/QRC20USDC.hyp` | QRC-20 USD Coin for **live Testnet V2 (20-byte)** |
| `*.hyp` | hyperion / QRVM |
| `../arc/*.sol` | solc 0.8.24 / Arc EVM (ERC-20 is correct there) |

Hyperion sources use the `.hyp` extension. They are a conservative Solidity
subset (no custom errors, try/catch, `immutable`, `ecrecover`, or assembly).
Arc `MessageTransmitter.sol` uses Arc's SLH-DSA-SHA2-128s precompile, not
`ecrecover`. Arc admin (pause, attester, minter, messenger, code pins, peer
seal) is the same SLH key; secp256k1 `msg.sender` cannot change the bridge.
The QRVM transmitter authenticates via ML-DSA-87 `msg.sender`. Each messenger
carries a code seal (chain id + addresses + extcodehashes). QRVM pins the Arc
seal and will not mint if Arc bytecode was swapped under elliptic-curve
consensus. ECDSA keys are rejected on the Arc↔QRL interface.

## Address width

Cross-chain fields are **always 64 bytes** on the wire (ARQL message version 2).
Helpers:

- 20-byte Arc / current-QRL: left-pad to 64, recover with `toAddress20` (high 44 bytes must be zero).
- 64-byte QRVM: the field *is* the address. Arc `toAddress20` will revert (`wide-addr`) until Arc contracts are upgraded to hold bytes64 recipients in an escrow map — the relayer does that translation during the transition.

`ADDRESS_BYTES` in `packages/addresses` is `20` or `64` from env
`QRL_ADDRESS_BYTES`.
