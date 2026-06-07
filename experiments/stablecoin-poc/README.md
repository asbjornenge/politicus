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

Those are PoC #2 territory — a mock-USDC FA2, a `create_bit` entrypoint that
accepts an optional `payer_override`, and a relayer-allowlist on
`VariablesLogic`.
