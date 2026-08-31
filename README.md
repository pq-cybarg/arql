# ARQL

Bridge **native USDC on Circle’s Arc Testnet** onto **QRL 2.0** as a stablecoin,
without leaving this folder and without violating Arc’s CCTP rules.

QRL 2.0 is **QRVM**, not EVM. Tokens on QRL are **QRC-20** (not ERC-20).
Contracts on that side are **Hyperion** (`.hyp`). Accounts are **ML-DSA-87**.
Addresses are mid-reset from 20 bytes (`Q` + 40 hex) to 64 bytes (`Q` + 128 hex).

## What you get

- Arc Solidity: lock native USDC; **SLH-DSA-SHA2-128s** attestation and admin (Arc precompile). ECDSA cannot move value or re-key the bridge.
- **Warning:** Arc consensus is still elliptic-curve. Corrupted validators can swap bytecode at a known address. The fix is a QRVM-anchored **code seal** (addresses + `extcodehash`); QRL will not mint unless that seal matches the Dilithium-pinned value. See [docs/architecture.md](docs/architecture.md) and [docs/audit.md](docs/audit.md).
- Sanctions: every lock/mint/unlock/burn is screened. OFAC-style lists are implementable via the compliance SLH key; the lockbox is not seizable (that would break 1:1). [docs/compliance.md](docs/compliance.md).
- QRVM Hyperion (`.hyp`): mint/burn QRC-20 USDC, attester = Dilithium `msg.sender`
- Iris-shaped API (`/v2/messages`, `/v2/attestations/:hash`)
- Relayer (1 Arc confirmation)
- Settlement desk UI
- Path for Ripple to issue **RLUSD** natively on QRVM: [docs/rlusd.md](docs/rlusd.md)

Circle will not mint native USDC on QRL until QRL is a CCTP domain. The QRL
token is a 6-decimal **QRC-20** named USD Coin, 1:1 with USDC locked on Arc.

## Quick local path

```bash
anvil --port 8545
# other terminal
forge test
npm install
bash scripts/demo-local.sh
# desk: http://127.0.0.1:7470
```

Public static desk: [pq-cybarg.github.io/arql](https://pq-cybarg.github.io/arql/).

## Layout

```
contracts/arc/           Solidity 0.8.24 for Arc EVM (ERC-20 USDC lock)
contracts/qrl/           Hyperion .hyp for QRVM (IQRC20, QRC20USDC)
contracts/qrl20/         20-byte live Testnet V2 QRC-20 USDC (hypc 0.0.2)
live/                    compile / wallet / faucet / deploy against QRVM
scripts/tui.mjs          terminal desk for live QRC-20 USDC
apps/web/                desk UI
```

## Mainnet-shaped deploy

1. Fund an Arc Testnet key with native USDC (gas + lock inventory) from the Circle faucet.
2. `forge script` the Arc stack against `https://rpc.testnet.arc.io` (chain 5042002).
3. Live 20-byte testnet: `npm run live:compile && npm run live:wallet && npm run live:faucet && npm run live:deploy`
   then `npm run tui` and `npm run web`. After the 64-byte reset, compile `contracts/qrl/QRC20USDC.hyp`.
4. Deploy QRVM contracts with `@theqrl/web3` + Dilithium mnemonic (`qrl_*` RPC).
5. `linkToken` both minters; set remote messengers to 64-byte padded addresses.
6. Run iris + relayer. Relayer Arc key pays USDC gas. Relayer QRL key is ML-DSA.

Do not call Circle TokenMessengerV2 (`0x8FE6…`) with destination 42424.
