# Stablecoin PoC — cross-runtime atomic call on Tezos X Previewnet

Minimum scaffold proving that:

1. An EVM-side Solidity contract can atomically call a Michelson contract via
   the Native Atomic Composability gateway precompile at `0xff…07`.
2. `Tezos.get_sender()` inside the Michelson side returns the **immediate
   caller's** KT1 alias (the forwarder's, not the EOA's) — so any flow that
   needs the underlying user identity must pass it as an explicit parameter
   or use the direct-call pattern (user → gateway, skipping the forwarder).

## Layout

- `contracts/Counter.mligo` — Michelson receiver. `increment` / `decrement` /
  `reset` entrypoints plus `last_sender` storage that the test script reads
  back to verify the identity model.
- `contracts/EvmToMichelsonCounter.sol` — Solidity forwarder. Uses a low-level
  `.call` to the NAC gateway (high-level interface calls EXTCODESIZE-fail
  because the precompile has no code).
- `scripts/generate-evm-key.mjs` — one-shot keypair generator; writes `.env`.
- `scripts/compile-{sol,mligo}.mjs` — separate compilers (solc-js, dockerized
  LIGO `1.7.0`).
- `scripts/deploy-{michelson,evm}.mjs` — originate / deploy on Previewnet.
- `scripts/trigger.mjs` — invokes `forwarder.increment()` and verifies the
  three assertions above.

## How to reproduce

```fish
node experiments/stablecoin-poc/scripts/generate-evm-key.mjs
# faucet the printed EVM address at faucet.previewnet.tezosx.nomadic-labs.com
node experiments/stablecoin-poc/scripts/compile-mligo.mjs
node experiments/stablecoin-poc/scripts/compile-sol.mjs
node experiments/stablecoin-poc/scripts/deploy-michelson.mjs
node experiments/stablecoin-poc/scripts/deploy-evm.mjs
node experiments/stablecoin-poc/scripts/trigger.mjs
```

Expected final line: `PoC succeeded — atomic cross-runtime call landed and
identity model behaves as documented.`

## What this PoC does NOT prove

- Token transfers (the counter doesn't move value).
- Per-user accounting (no identity-aware logic).
- Relayer-style sponsorship (the EVM EOA pays its own gas).

Those gaps are filled by PoC #2 below.

---

# PoC #2 — cross-runtime USDC payment

Proves that a user can pay in (mock) ERC-20 USDC on the EVM side and have an
atomic state mutation happen on the Michelson side — the on-chain shape that
the eventual bit-payment-in-USDC flow needs.

## Layout (added)

- `contracts/MockUSDC.sol` — minimal ERC-20 standing in for LayerZero-bridged
  USDC. 6 decimals. Admin-only `mint`.
- `contracts/PoliticsPayments.sol` — escrow forwarder. Pulls USDC via
  `transferFrom`, then calls Michelson via the NAC gateway with a Micheline-
  encoded `Pair(payer_bytes20, Pair(amount_nat, content_bytes))`. Includes
  hand-rolled Micheline encoders for `bytes`, `nat`, and `Pair`.
- `contracts/PaymentReceiver.mligo` — verifies sender = configured forwarder
  KT1 alias, stores the payment indexed by sequential id and by EVM payer.
- `scripts/deploy-poc2.mjs` — deploys all three (USDC, receiver, forwarder)
  and wires `expected_forwarder` to the forwarder's KT1 alias.
- `scripts/trigger-poc2.mjs` — mints + approves + pays, then verifies USDC
  flow on EVM and payment record on Michelson.
- `scripts/redeploy-forwarder.mjs` — partial-redeploy helper for when only
  the forwarder bytecode changed.

## Run

```fish
node experiments/stablecoin-poc/scripts/compile-sol.mjs
node experiments/stablecoin-poc/scripts/compile-mligo.mjs
node experiments/stablecoin-poc/scripts/deploy-poc2.mjs
node experiments/stablecoin-poc/scripts/trigger-poc2.mjs
```

Expected: `PoC #2 happy path verified ✓`.

## Gotcha — Micheline zarith encoding

The first byte of a zarith `int`/`nat` literal carries only **6** magnitude
bits, not 7: `[continuation(1) | sign(1) | data(6)]`. Subsequent bytes use
the standard `[continuation(1) | data(7)]`. Treating the first byte the
same as the rest produces silently-malformed payloads — the gateway
reverts with empty data on the EVM side, so the trail is hard to find.
This trapped a first attempt; the fix is in `PoliticsPayments._encodeNat`.

## Atomic revert — empirically confirmed

The first failed attempt (before the zarith fix) burned ~1.24M gas on the
EVM side but moved no USDC and incremented no receiver state. That is the
gateway propagating the Michelson failure back through the forwarder's
low-level `.call`, which then re-reverts via inline assembly. The whole
EVM transaction is atomic with respect to the Michelson outcome.

## Production-mapping

For mainnet, replace `MockUSDC` with the LayerZero-bridged USDC contract
already deployed on Etherlink/Tezos X (`0x796Ea11…00F9` at the time of
writing). The forwarder and receiver designs carry over unchanged; the only
real-world friction is that LayerZero introduces a bridge-counterparty
trust assumption that Circle's native CCTP would not (no public ETA for
CCTP on Etherlink/Tezos X as of June 2026).
