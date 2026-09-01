# ARQL architecture

ARQL is a CCTP-shaped bridge that moves **native Circle USDC on Arc Testnet**
onto **QRL 2.0** as a 6-decimal QRC-20 named USD Coin.

## Why not Circle CCTP itself

Arc’s canonical USDC path is Circle CCTP V2 (domain `26`). TokenMessengerV2
burns native USDC and Iris attests only for **registered domains**. QRL is not
a Circle domain. Calling `depositForBurn` toward QRL on Circle’s contracts
reverts.

Arc’s bridge integration rules still apply:

- do not deploy wrapped USDC (`wUSDC`, `USDC.e`) on Arc
- one confirmation is final
- relayers pay gas in USDC, not ETH
- watch `MessageSent` over WebSocket
- no PREVRANDAO, no blob txs

ARQL therefore **locks** official Arc USDC (ERC-20 at
`0x3600000000000000000000000000000000000000`) in a TokenMinter. It never
mints a second USDC on Arc.

## QRVM is not the EVM

QRL 2.0 executes **Hyperion** on the **QRVM**. Contracts look like Solidity
and live in `contracts/qrl/*.hyp`. Differences that bind this design:

| | Arc | QRL 2.0 |
| --- | --- | --- |
| VM | EVM (Osaka) | QRVM |
| Language | Solidity 0.8.24 | Hyperion `.hyp` |
| Signatures | SLH-DSA-SHA2-128s (Arc precompile `0x1800..0004`); ECDSA rejected | ML-DSA-87 |
| RPC | `eth_*` | `qrl_*` |
| Address display | `0x` + 40 hex | `Q` + 40 hex today, `Q` + 128 hex after reset |
| Address width | 20 bytes | mid-migration 20 → 64 bytes |
| Word / ABI slot | 32 bytes | migrating to 64-byte VM64 (`Panic(uint512)`) |
| Block time | sub-second | ~60 s |
| Finality | BFT, 1 block | PoS, treat 1 as enough on testnet |

Packed messages (not ABI encoding) keep a single wire format across 32-byte
EVM words and 64-byte QRVM words.

## Message version 2

CCTP V2 uses `bytes32` addresses. QRVM is moving to 64-byte addresses, so
ARQL version `2` uses **bytes64** for every address field, left-padded when
the account is still 20 bytes.

Attestation:

- **Arc**: SLH-DSA-SHA2-128s via Arc’s PQ verify precompile
  (`0x1800000000000000000000000000000000000004`). 64/65-byte ECDSA is
  `ecdsa-forbidden` on deposit, attest, and attester registration. No
  `ecrecover`.
- **QRL receive**: ML-DSA-87 `msg.sender` (QRVM transactions are Dilithium).

## Flow

Arc → QRL

1. User approves ARQL TokenMessenger to spend native USDC (6 decimals).
2. `depositForBurn` pulls USDC into TokenMinter (lock, not burn).
3. Transmitter emits `MessageSent`.
4. Relayer attests (Iris-shaped API at `/v2/messages`).
5. Relayer calls QRVM `receiveMessage(bytes)` as the Dilithium attester.
6. TokenMessenger mints QRC-20 USDC 1:1.

QRL → Arc (return)

1. User on QRVM calls `depositForBurn` on the Hyperion TokenMessenger. The
   transaction itself is **ML-DSA-87**; QRVM cannot submit secp256k1. QRC-20
   USDC is burned (MintBurn), not locked.
2. Transmitter emits `MessageSent` (same version-2 bytes64 body).
3. Relayer attests with **Arc SLH-DSA-SHA2-128s**, never ECDSA. A 64/65-byte
   secp256k1 attestation is `ecdsa-forbidden`.
4. Relayer (or anyone, if `destinationCaller` is zero) submits
   `MessageTransmitter.receiveMessage(message, slhPk, slhSig)` on Arc. The
   precompile at `0x1800..0004` must return true.
5. TokenMessenger unlocks **native** Circle USDC from TokenMinter to the
   mintRecipient. No wrapped USDC is created on Arc.

A quantum-broken ECDSA key cannot: burn QRC-20 (QRVM rejects the tx), attest
the burn (SLH-DSA required), unlock Arc USDC (`ecdsa-forbidden`), or administer
the Arc contracts. Owner, pause, attester, minter, messenger, and token-link
updates require owner and guardian SLH-DSA over a nonce-bound digest. Pause is
a third SLH key that cannot unpause or re-key. A secp256k1 `msg.sender` is
irrelevant.

## Warning: Arc consensus can swap bytecode

Arc's validator set still attests blocks with elliptic-curve signatures.
**This is not fully closable on Arc.** If that underlay is corrupted (or the
SLH-DSA precompile at `0x1800..0004` is made to lie), an attacker can replace
bytecode at a known address without any contract-level owner call. On-Arc
`onlyOwner` / SLH checks then verify against a lying chain.

ARQL does not pretend that is solved on Arc. The controlling verifier is
**QRVM** (ML-DSA-87 consensus). The fix is a QRVM-anchored **code seal**:

1. Each TokenMessenger snapshots `extcodehash` of itself, its TokenMinter, and
   its MessageTransmitter (`freezeLocal`; Arc owner+guardian SLH, QRVM Dilithium).
2. Outbound burn bodies prefix `hookData` with a seal over chain id, the
   messenger/minter/transmitter **addresses**, and their `extcodehash` values.
   Address binding stops a second deploy of the same bytecode from impersonating
   the pinned messenger.
3. The peer chain stores that seal (`setPeerSeal`). QRVM is the source of
   truth for the Arc seal; Arc stores the QRVM seal.
4. Before mint or unlock, the receiver checks (a) local `extcodehash` values
   still match the pin (`codehash`) and (b) the inbound seal matches
   (`peer-seal`). A swapped Arc implementation cannot mint on QRL. A swapped
   QRL implementation cannot drain native USDC held in TokenMinter.
5. Rotating a seal or pin requires owner **and** guardian SLH-DSA. ECDSA
   cannot do it. Relayer also recomputes `extcodehash` before attesting.

Fail closed: an unpinned messenger or a zero peer seal refuses execution.
A swapped Arc implementation can still write whatever it wants on Arc; it
cannot mint on QRL unless QRVM's Dilithium owner also re-pins the new seal.

## Sanctions and enterprise

Deposits, mints, unlocks, and burns refuse sanctioned or frozen accounts
(`ComplianceRegistry` on Arc; owner-set lists on QRVM). Compliance SLH can
add names; owner and guardian must both sign to remove one. Native USDC
held in TokenMinter is **not** seized: that would break 1:1 against in-flight
mints. See [compliance.md](compliance.md).

## Domains

- Arc Testnet: **26** (Circle)
- QRL 2.0 Testnet: **42424** (ARQL assignment, unofficial)

When Circle lists QRL as a CCTP domain, stop locking in ARQL's TokenMinter
and point the messenger at Circle's TokenMessengerV2. The QRC-20 can then be
abandoned in favor of native Circle USDC.
