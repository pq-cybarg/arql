# Making RLUSD issuable on QRL 2.0

Ripple USD (RLUSD) is issued by Standard Custody & Trust (NYDFS) and is
native on **XRP Ledger** and **Ethereum**. Expansion to other EVM chains has
gone through **Wormhole NTT** (issuer-controlled mint/burn, no lock pool) and
Ripple Mint (institutional mint/redeem APIs). QRL 2.0 is not an EVM chain, so
none of those rails attach as-is.

## What Ripple actually requires

1. **Issuer control of supply.** NTT and native issuance both keep
   Standard Custody as `masterMinter`. A third-party lock/mint of Ethereum
   RLUSD is a bridged IOU, not RLUSD.
2. **NYDFS chain listing.** Each new public chain is a supervised product
   change. QRVM, Hyperion, and 64-byte addresses have to be in the memo.
3. **QRC-20 controls.** Blacklist, pause, minter allowances,
   6 decimals, `USD` currency. ARQL’s `QRC20USDC.hyp` already matches that
   shape (Circle FiatToken pattern, QRC-20 on QRVM).
4. **Post-quantum signatures.** Ethereum RLUSD txs are secp256k1. QRVM txs
   are ML-DSA-87. Ripple’s Ethereum minter key cannot sign a QRL mint.
5. **Address width.** Wormhole NTT transceivers assume 20-byte recipients.
   QRL is mid-migration to 64-byte addresses. NTT messages would truncate.

## Feasible path (in order)

### A. Native QRVM issuance (the only path that is actually RLUSD)

1. Compile `contracts/qrl/QRC20USDC.hyp` with `name = "Ripple USD"`,
   `symbol = "RLUSD"`, `decimals = 6`, `currency = "USD"`.
2. `masterMinter =` a Standard Custody Dilithium address (34-word ML-DSA
   mnemonic via `@theqrl/wallet.js`). Their Ethereum minter is useless here.
3. Wait out the **64-byte address reset**. Do not list RLUSD against the
   20-byte testnet if mainnet will be 64-byte — holders cannot be migrated
   by renaming.
4. File NYDFS for “RLUSD on QRL 2.0 (QRVM / Hyperion / ML-DSA-87)”.
5. Wire Ripple Mint: a QRVM adapter that turns a mint intent into
   `QRC20USDC.mint` signed by the Dilithium master minter. RPC namespace
   is `qrl_*`, not `eth_*`.
6. Blocklist + pause operated by the same compliance desk as Ethereum RLUSD.

This is native issuance. Supply on QRL is independent of Ethereum/XRPL
supply and backed by the same reserve. No bridge.

### B. Wormhole NTT after a QRVM transceiver exists (not today)

NTT would let Ethereum RLUSD burn and QRL RLUSD mint under issuer keys.
Missing pieces:

- Wormhole guardian set does not observe QRVM `qrl_*` logs or 64-byte
  addresses.
- No Hyperion transceiver / NTTmanager. `.hyp`, not Solidity, and no
  `ecrecover` for VAAs unless they keep ECDSA on QRVM (which undoes QRL’s
  reason to exist).
- VAAs are ECDSA-attested. A quantum-safe chain accepting ECDSA VAAs as
  mint authority is a policy decision Ripple has to own.

Estimate: a dedicated QRVM transceiver + 64-byte payload codec + Dilithium
(or threshold ML-DSA) mint authority. Do not reuse the Ethereum NTT
manager bytecode.

### C. What not to do

- **Do not** lock Ethereum RLUSD in a third-party vault and mint a
  `RLUSD.e` on QRL. That is wrapped RLUSD, not RLUSD, and it fights
  Ripple’s NTT stance the same way wrapped USDC fights Arc’s CCTP stance.
- **Do not** point ARQL’s USDC lockbox at RLUSD. ARQL’s Arc leg is
  Circle-native USDC. Mixing issuers in one minter is a reserve lie.
- **Do not** ship RLUSD on the 20-byte testnet and “upgrade” addresses
  in place. The reset is a network reset.

## What ARQL already gives Ripple

The same QRVM stack can host a second QRC-20:

| Piece | USDC (ARQL) | RLUSD (Ripple) |
| --- | --- | --- |
| Token | `QRC20USDC.hyp` symbol USDC | same QRC-20, symbol RLUSD |
| Master minter | ARQL TokenMinter | Standard Custody Dilithium |
| Attestation | ARQL relayer | Ripple Mint / future NTT |
| Arc lock | native Circle USDC | none (do not lock USDC as RLUSD) |
| Ethereum burn | n/a | NTT or native Ethereum burn |

`TokenMinter.linkToken` already supports multiple local tokens. Deploy a
second QRC-20, set `masterMinter` to Ripple, do **not** link it to Arc
USDC.

## Sequence Ripple can execute

1. Freeze QRL address width (64-byte mainnet genesis).
2. Dilithium custody for Standard Custody (HSM story is unsolved; ML-DSA-87
   keys are not in typical bank HSMs yet — this is the longest pole).
3. Hyperion `QRC20USDC.hyp` (as RLUSD) deploy + verify on ZondScan.
4. NYDFS addendum.
5. Ripple Mint QRVM adapter (`qrl_sendRawTransaction`).
6. Optional later: Wormhole QRVM transceiver if they want Ethereum ↔ QRL
   fungibility of the same RLUSD.

Until (2) and (4) exist, any QRL “RLUSD” is a demo token. ARQL’s USDC path
does not unblock that; it only proves the QRVM QRC-20 + minter pattern.
