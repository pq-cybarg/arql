# Enterprise and sanctions

ARQL can be operated as a regulated USDC path. The on-chain gates are
implemented; OFAC/SDN ingestion, travel-rule messaging, and case
management stay off-chain and write into these gates.

## What is implemented

| Control | Where | Who |
| --- | --- | --- |
| Sanctions denylist (20-byte) | `ComplianceRegistry` on Arc; mappings on QRVM messenger / live QRC-20 / `ArqlBridge` | Compliance SLH (Arc) / Dilithium owner (QRVM) |
| 64-byte wire denylist | `sanctionedWire[keccak256(addr64)]` | same |
| Freeze (cannot send or receive) | registry `frozen`; live QRC-20 `frozen` | compliance |
| Screen depositor | `depositForBurn` before `transferFrom` | automatic |
| Screen mint recipient | deposit + `handleReceive` before mint/unlock | automatic |
| Token blacklist | Circle-shaped `FiatToken` / QRVM `QRC20USDC` | owner |
| Pause | pauser SLH (Arc) / owner (QRVM) | cannot unpause alone on Arc |
| Dual control | owner + guardian to unlist or rotate compliance | cannot silently clear a name |
| Audit | `Sanctioned`, `Frozen`, `Locked`, `MintAndWithdraw` | — |

Listing a name is a hot path (OFAC add). **Unlisting requires owner and
guardian.** A compromised compliance key can halt flow to a victim; it
cannot un-sanction an SDN name.

## What we deliberately do not do

**The Arc lockbox is not seizable through ARQL.** Native USDC in
`TokenMinter` is a pooled escrow for in-flight CCTP-shaped messages.
Draining it to a treasury while a QRL mint can still succeed would
issue QRC-20 against missing Arc USDC (over-issuance). Stuck funds stay
in the minter: conserved, not returned, not stolen.

If a mint is rejected because the recipient is sanctioned:

- Arc USDC remains in the lockbox (see `testMintRejectedAfterLockConservesArcUsdc`)
- QRC-20 is not minted
- Retry mint stays blocked until council unsanctions
- There is no timeout refund (that races a late mint)

Official Circle USDC on Arc still has Circle's own blacklist. ARQL
refuses earlier so we do not lock toward a name we will not mint to.

## Off-chain (implementable, not in this repo)

- SDN/OFAC/EU/UN feed → `sanction` / `sanctionWire` / `freeze`
- Travel Rule originator/beneficiary payload in `hookData` (already
  prefixed with the 32-byte code seal; user hook follows)
- Attester policy: do not finalize if screening fails
- Case system for false positives; council unsanction
- Next QRC-20 deploy: construct with sealed `ArqlBridge` as minter so
  live `blacklist` / `freeze` sit on the token that actually mints
