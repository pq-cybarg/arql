# ARQL adversarial audit

Scope: Arc lock/unlock stack (`contracts/arc`) and QRVM mint/burn stack
(`contracts/qrl`, `contracts/qrl20`). Date: 2026-08-29. Method: Foundry
adversary suite (`contracts/test/Adversary.t.sol`, `Bridge.t.sol`) plus
manual review of Hyperion, relayer, and desk paths.

Threats in scope: quantum-broken secp256k1, elliptic-curve consensus
corruption on Arc, rogue messengers, replay, attester spoofing, bytecode
swap via `extcodehash` change.

## Warning: Arc consensus can swap bytecode

Arc validators still sign blocks with elliptic-curve signatures. If that
layer is corrupted, or if precompile `0x1800..0004` is made to lie, an
attacker can replace bytecode at a known address **without** a
contract-level owner call. Every on-Arc SLH check then runs on a lying
machine. That risk is inherent to building on an EC-consensus L1. It is
**not closed** by putting SLH in the contracts.

## The fix: QRVM-anchored code seal

QRVM (ML-DSA-87) is the controlling verifier:

1. `freezeLocal` pins live `extcodehash` of messenger, minter, and
   transmitter (owner + guardian SLH on Arc; Dilithium owner on QRL).
2. Every burn body prefixes `hookData` with
   `keccak(abi.encode(chainid, messenger, messenger.hash, minter,
   minter.hash, transmitter, transmitter.hash))`. Addresses are in the
   seal so a second deploy of the same bytecode cannot impersonate the
   pinned messenger (clone-seal collision, found and fixed in this
   audit).
3. The peer stores that value as `expectedPeerSeal`. QRVM pins the Arc
   seal; Arc pins the QRVM seal.
4. Before mint or unlock the receiver checks (a) local `extcodehash`
   still matches the pin (`codehash`) and (b) the inbound seal matches
   (`peer-seal`).
5. Relayer recomputes the seal from `eth_getCode` / `extcodehash` and
   refuses to attest on mismatch.

A swapped Arc implementation can still mutate Arc state. It **cannot
mint on QRL** unless the Dilithium owner also re-pins the new seal.
That is the residual that must stay in the operator runbook.

## Verdict

Value-moving admin on Arc is dual SLH-DSA (owner + guardian). Pause is
a separate SLH pauser that cannot unpause or re-key. User deposits
require a **registered** per-account SLH key. Attestation is 2-of-N.
QRVM admin is ML-DSA-87 `msg.sender`. 64/65-byte ECDSA is
`ecdsa-forbidden` on every path that can move value or change the
bridge.

Round-trip lock/mint and burn/unlock hold under fuzz (256 runs).

## Controls that held

| Attack | Result |
| --- | --- |
| ECDSA pause / setTokenMessenger / setPeerSeal / pinCodehash / linkToken / blacklist / setRemoteTokenMessenger | `ecdsa-forbidden` |
| Owner SLH without guardian on peer seal | `pq-guardian` |
| 20-byte EC account as owner or attester | `slh-pk` / `ec-key-forbidden` |
| Unregistered account deposit | `unregistered` |
| Single attester on Arc receive | `threshold` |
| Replay of a consumed pauser signature | `pq-pauser` (nonce) |
| 65-byte ECDSA attestation on Arc receive | `ecdsa-forbidden` |
| Wrong QRL attester | `attester` |
| Replay of a finalized message | `nonce` |
| `vm.etch` of transmitter after `freezeLocal` | `codehash` on deposit |
| `vm.etch` of minter after lock | `codehash` on unlock |
| Wrong peer seal Arc or QRL | `peer-seal`; inventory stays in TokenMinter / unminted |
| Second TokenMessenger deploy of the same bytecode | distinct `localSeal` (address-bound) |
| Rogue messenger toward QRL | `peer-seal` |
| Zero amount | `amount` |

## Finding: clone seal collision (fixed)

A first-cut seal was `keccak(codehash(messenger) || codehash(minter) ||
codehash(transmitter))`. Two `TokenMessenger` instances sharing the same
minter and transmitter produced the **same seal**.

Fix: seal is `keccak(abi.encode(chainid, messenger, messenger.hash,
minter, minter.hash, transmitter, transmitter.hash))`.

## Closed residuals

1. **Per-account SLH registry.** `registerAccount` binds `msg.sender` to
   one 32-byte SLH key. `depositForBurn` requires that key. Stolen ECDSA
   of Alice plus an attacker SLH no longer deposits Alice's allowance.
2. **Split PQ keys.** Owner + guardian must both sign high-impact
   changes. Pauser can halt only. Three keys must be distinct.
3. **Threshold attesters.** Arc `receiveMessage` requires two distinct
   SLH attesters. QRVM `receiveMessage` tallies Dilithium attesters and
   executes at threshold 2.
4. **Live `ArqlBridge.mint` removed in source.** `receiveMint` always
   requires a pinned nonzero Arc seal. A sealed instance is on QRVM at
   `Q360b826e…`. The original token's minter is still `Q89b8cdf9…` (the
   first bridge): `setMinter` is minter-only and that contract has no
   passthrough, so the live 1000-USDC demo cannot rotate. The next QRC-20
   deploy should construct with the sealed bridge as minter.
5. **`MessageTransmitterQrl` refuses Arc chain id 5042002.** Dilithium
   `msg.sender` Ownable is QRVM-only.
6. **`TestnetUSDC.mint` is minter-only.** Local demo token cannot be
   inflated by a random ECDSA account.

## Remaining warning (not closed)

Arc elliptic-curve consensus and a dishonest SLH precompile. See the
warning and the QRVM code-seal fix at the top of this document.

## Relayer / desk

- Relayer refuses 64/65-byte signatures and `from.ecdsa`.
- Relayer recomputes the Arc/QRL code seal before attesting.
- SDK `depositCalldata` requires 32-byte pk and 7856-byte sig.
- The public site does not sign. Signing is not part of the published tree.

## Secret scanning

CI runs TruffleHog on the published history. GitHub secret scanning and
push protection are enabled on the remote.
