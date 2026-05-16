# Politicus Architecture (DRAFT)

> This document describes the technical architecture of Curious Politicus. For the conceptual model and data shapes (Bit, BitVote, Petition, etc.), see [README.md](./README.md).

## 0. Build status snapshot

As of mid-May 2026, deployed to Tezlink Shadownet:

| Contract           | Address                                          | Status |
|--------------------|--------------------------------------------------|--------|
| Variables          | `KT1CM56B5QdrVnBPc2RRc5KC9YeUJyxQGeWU`           | live, bootstrap-admin pattern |
| Treasury           | `KT1KKH5KPTmYJ5NtLnShMiWHVhU4wik3Pcih`           | live |
| IdentityRegistry   | `KT1LBdKpeUNd2hq49q4keziRm431QYytyBfS`           | live, with `total_users` counter |
| BitRegistry        | `KT193vzUnno9keXoAgpCunscMUYUviREE96d`           | live |
| PetitionRegistry   | `KT1UEUHiDvszkQeRYNEexdTUgGxtfyaJ86xq`           | live, 5 action types |
| ModerationRegistry | `KT1PRAZuSK9gGBGukrtyuUwoVojhL9G6XyQU`           | live |
| SyndicateRegistry  | —                                                | deferred |
| BitNFTFactory      | —                                                | deferred (Phase E) |

Off-chain stack live in `docker-compose.yml`:

- **PostgreSQL 16** with 4 migrations (init, petitions, moderation, petition_votes)
- **Indexer** (Node + porsager/postgres) polling TzKT bigmaps + ops with adaptive 2s/8s cadence
- **API** (Hono + Postgres) — content storage, joined feeds, moderation enforcement (HTTP 451)
- **Web** (Vite + React + Taquito + react-router + react-markdown + lucide-react) — full feed, petitions, moderation, profile, threaded replies, optimistic UI

**Phase status:**
- Phase A (Variables, Treasury, IdentityRegistry, BitRegistry): ✓ done
- Phase B (PetitionRegistry, governance loop): ✓ done
- Phase C (ModerationRegistry, moderation petitions): ✓ done
- Phase D (Syndicate): deferred (not designed yet — advisory vs enforced is undecided)
- Phase E (BitNFT FA2): deferred (Phase E, blocking on stablecoin denomination decision)

The kernel as described in README.md is functionally complete modulo the deferred items.

## 1. Overview

Politicus is a publishing platform whose core invariant is: **every piece of content carries cryptographic proof of who created it, and every state change to the platform itself is governed by signed, costed actions from verified humans.**

Three properties shape the architecture:

1. **On-chain is small, off-chain is heavy.** The blockchain stores hashes, signatures, votes and governance state. Bytes (text, images, video) live off-chain in content-addressed storage. This is what makes moderation and legal compliance possible despite chain immutability.
2. **Protocol is a kernel, not a product.** The on-chain rules are intentionally minimal. Discovery, ranking, summaries, hashtags, search, UI — all of that lives in clients and indexers. The kernel does not opinionate on user experience.
3. **The user is the unit of trust.** Each user is a verified-unique human (via BrightID). Optional identity claims sit on top. Bots and duplicates are blocked at the protocol layer.

## 2. Design Principles

- **Signed by default.** A piece of content without a verifiable signature is not a Bit. There is no anonymous publishing primitive.
- **Costed by default.** Every state-changing action has a price. This is anti-spam, pro-creator-revenue, and pro-deliberation. It is also exclusionary at the margin; we keep costs low and accept the tradeoff.
- **Governable by default.** Every economic and procedural parameter is a kernel variable that can be changed by petition.
- **Replaceable by default.** Indexers, clients, summarizers, verifiers — all are pluggable. No single operator is load-bearing.
- **Honest about tradeoffs.** Where the architecture has tensions (e.g. provenance vs. activist anonymity, immutability vs. GDPR), we name them rather than paper over them.

## 3. System Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  Clients (web, mobile, CLI)                                      │
│  - Reference client + 3rd-party clients                          │
│  - Renders Bits, votes, profiles, NFT galleries                  │
│  - Verifies signatures + hashes locally                          │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Indexers / Summarizers / Verifiers (off-chain services)         │
│  - Watch chain events, index Bits, expose query APIs             │
│  - AI summarizers as User-operated agents                        │
│  - Verifiers issue identity attestations                         │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Content Storage (off-chain)                                     │
│  - IPFS, Arweave, dedicated indexer storage                      │
│  - Content-addressed by hash that matches Bit.Content            │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Protocol Layer (Tezos X — Michelson smart contracts)            │
│  - Bit / BitVote / Petition / ModerationEntry registry           │
│  - Kernel variable storage + governance                          │
│  - FA2 contracts for BitNFTs                                     │
│  - Treasury contract                                             │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Identity Layer                                                  │
│  - BrightID for proof-of-personhood (mandatory)                  │
│  - Verifiers for identity attestations (optional, opt-in)        │
└──────────────────────────────────────────────────────────────────┘
```

Each layer is described below.

## 4. Identity Layer

### Proof of personhood — BrightID

- User obtains a BrightID verification via social-graph attestation (no biometrics).
- User generates a Tezos keypair; the public key becomes their `UID`.
- The BrightID verification is linked to the public key on-chain (via signed attestation submitted to the protocol's identity contract).
- The protocol enforces: one BrightID-verified human = at most one active `UID`.

This gives us *unique humans* without binding to legal identity. Pseudonymous use is first-class.

### Optional identity verification

- A separate `Verifier` role issues `VerificationClaim` objects: signed assertions that "key X belongs to person Y at organization Z."
- Verifiers are themselves Users. Anyone can be a verifier; trust in a verifier is a client/indexer concern.
- Examples: a press organization verifying its journalists; a university verifying its researchers; a self-service verifier checking domain ownership.
- Clients display verification badges based on which verifiers they trust. There is no single "blue checkmark."

### Threat model

- **Worldcoin-style attacks (verification sold on grey market)**: BrightID's social-graph approach makes this harder than biometric approaches but not impossible. Acceptable residual risk.
- **Sybil attacks via fake BrightID identities**: BrightID's own threat model applies. We do not solve this; we rely on it.
- **Identity verification fraud**: Mitigated by verifier reputation. If a verifier issues false claims, indexers stop trusting it.

## 5. Storage Layer

### What lives on chain

- Hashes of content
- Signatures
- Votes and vote tallies
- Petition state
- Moderation entries
- Kernel variables
- FA2 token state for BitNFTs
- Treasury balances

### What lives off chain

- The bytes of all content (text, images, video, audio)
- Indexer-derived state (search indices, social graphs, ranking)
- Client UI state
- AI summaries (which are themselves Bits, so their *hashes* are on-chain)

### Content addressing

`Bit.Content = hash(content_bytes)`. Bytes are stored in any content-addressable system (IPFS, Arweave, traditional HTTP host with hash verification). Clients fetch bytes, recompute the hash, and verify it matches the on-chain `Content` field before rendering.

### Removal semantics

REM-moderated content is removed *from compliant indexers and gateways*. The on-chain hash and signature remain forever. A determined adversary can re-host the bytes; this is true of all internet content and not a problem we claim to solve. What we do guarantee: through the canonical network, REM-ed content becomes unreachable.

## 6. Protocol Layer (Tezos X)

Deployed as Michelson smart contracts on [Tezos X](https://tezos.com) (currently Tezlink Shadownet). No custom rollup. Politicus inherits security and durability directly from Tezos L1.

### Contract topology (as built)

```
PoliticusKernel
├── IdentityRegistry        - BrightID → UID bindings, total_users counter, count_users view
├── BitRegistry             - Bit and BitVote storage, calls IdentityRegistry + Variables + Treasury
├── PetitionRegistry        - Petitions of 5 action types, calls Variables and ModerationRegistry on resolve
├── ModerationRegistry      - moderated_content + moderated_users big_maps, admin = PetitionRegistry
├── Variables               - Kernel variables, dual-admin: PetitionRegistry + bootstrap_admin
├── Treasury                - Receives action fees + BitNFT cuts, admin-controlled withdraw
├── SyndicateRegistry       - deferred (Phase D)
└── BitNFTFactory           - deferred (Phase E)
```

### Bootstrap admin pattern (Variables)

Variables has two writers:

- **admin** (PetitionRegistry after the bootstrap transfer): can always write.
- **bootstrap_admin** (the deployer, optional): can write only when `total_users < BootstrapUserThreshold` (read live from IdentityRegistry's `count_users` view).

Bootstrap_admin can ratchet `BootstrapUserThreshold` *down* (never up), and may voluntarily retire via `retire_bootstrap_admin`. Once `total_users` hits the threshold, bootstrap_admin's writes silently fail — the contract enforces sunset automatically without any explicit migration step.

The intent is a graceful handoff: during bootstrap, the creator can tune the kernel quickly; once there's enough population for quorum to be meaningful, only successful petitions can change anything.

Why split this way:

- **Each registry is independently upgradeable** via KERNEL petitions, without touching unrelated state.
- **BitNFTFactory issues per-author FA2 contracts**, which keeps token state clean and lets standard FA2 tooling work out of the box (OBJKT marketplaces, wallets, etc.).
- **Treasury is a single contract** so governance changes to `TreasuryAddress` are atomic.

### Why Michelson (not EVM-side)

- Formal verifiability matches the constitutional/kernel ethos. We want governance contracts that can be mathematically reasoned about.
- LIGO gives us a high-level language without giving up Michelson's verification properties.
- Tezos X allows EVM-side composability if needed later (e.g. integrating with an EVM-side stablecoin), without forcing the core contracts to be Solidity.

### Why no rollup

Earlier drafts proposed Politicus as its own Tezos rollup. We rejected this because:

- Volume is moderate (journalist-focused, not consumer-mass).
- Only hashes/signatures/votes are on chain; the data footprint is small.
- A custom rollup means operating sequencers, kernel updates, DA coordination — large operational burden for limited gain.
- Tezos X with the DAL provides ~1300 TPS, which is far more than required.
- Direct L1 deployment gives composability with the broader Tezos ecosystem.

## 7. Indexer Layer

Indexers are off-chain services that watch the chain and provide queryable views. They are not part of the protocol — anyone can run one.

### Responsibilities

- Watch contract events (new Bits, votes, petitions, moderation actions).
- Fetch the corresponding off-chain bytes from content storage; verify hashes.
- Maintain search indices, social graphs, ranking signals.
- Honor moderation: do not serve bytes for REM-ed content; do not serve content from MOD-ed users.
- Expose HTTP/GraphQL APIs for clients.

### Multiple indexers, by design

- A reference indexer is run by the platform creator with high SLA.
- Specialized indexers may filter by language, topic, region, or moderation policy.
- Jurisdiction-specific indexers may apply local legal compliance (e.g. an EU indexer that respects court orders, an indexer that refuses certain content categories).
- Clients can configure which indexer(s) they use, or aggregate.

This is the architecture's answer to "who controls what people see": no one does, by design. Different indexers serve different views; the user picks.

### AI summarizers as a special case of indexer

AI-generated "news front pages" are User-operated agents that read recent Bits and publish summary Bits. They:

- Are owned by a human User (the operator is accountable).
- Publish signed Bits like any other user.
- Must reference source material by BID (not paraphrase). Quotes and claims must be verifiable.
- Should set a `machine_generated` flag (open question: kernel-level boolean on Bit, or convention).

If an AI summarizer hallucinates, the produced Bit is moderable like any other.

### Reference indexer (as built)

Lives in `indexer/`. Node + porsager/postgres + native fetch against TzKT's REST API. Five sources are tracked:

| Source | TzKT endpoint | Cursor field | Target table |
|---|---|---|---|
| bigmaps | `/v1/bigmaps/updates?bigmap.in=<users,bits,petitions,mod_content,mod_users>` | `offset.cr` | `users`, `bits`, `petitions`, `moderated_content`, `moderated_users` |
| votes | `/v1/operations/transactions?target=BitRegistry&entrypoint=vote_bit` | `id.gt` | `votes` |
| petition_votes | `/v1/operations/transactions?target=PetitionRegistry&entrypoint=vote_petition` | `id.gt` | `petition_votes` |

**TzKT quirk:** `id.gt` is silently ignored on `/v1/bigmaps/updates` — must use `offset.cr` instead. We learned this the hard way (entries kept getting re-indexed each cycle until we switched filters). The two operation endpoints honor `id.gt` correctly.

All upserts are idempotent (`ON CONFLICT DO UPDATE`), so resetting cursors and replaying is always safe.

Polling cadence is 10s baseline. The web app's adaptive polling (2s vs 8s) is independent of the indexer.

## 8. Client Layer

Clients are user-facing applications. The reference client is run by the platform creator; third-party clients are encouraged.

### Client responsibilities

- Wallet abstraction (the user should not need to understand Tezos directly).
- Signing of all user actions.
- Local verification of signatures and hashes on every Bit rendered.
- Fetching content bytes from content storage.
- Querying indexers for feeds and search.
- BrightID linking flow during onboarding.
- BitNFT minting, browsing, transfer.

### Reference client (as built)

Lives in `web/`. Stack: Vite + React 18 + TypeScript, react-router-dom (HashRouter), Taquito (InMemorySigner — dev mode, see notes below), react-markdown + remark-gfm, lucide-react for icons. Routes: `/`, `/petitions`, `/bit/:bid`, `/petition/:pid`, `/user/:address`.

Implemented:

- Feed with compose form, optimistic placeholders, adaptive polling (2s when watching pending writes, 8s idle), and markdown rendering.
- Vote / moderate / reply on each Bit with per-button spinners that hold until the indexer reflects the change. Buttons disable when you've already voted to prevent same-direction re-votes.
- Petitions tab with a kernel-variable dropdown (grouped: Action costs, Quorums, Majorities, Time, Treasury, Bootstrap) showing current value + unit. Yay/nay/resolve buttons with progress.
- Single-bit page with ancestor thread (recursive parent chain, collapsible), votes list, replies, reply compose.
- Single-petition page with full action payload + state + voting.
- Profile page with editable username/bio, last 50 bits.
- Moderation enforcement is visible: moderated content is removed from feeds entirely; direct hash access returns HTTP 451; moderated users get a flag on profile.

Dev wallet: a paste-`edsk…`-into-localStorage flow. **This is dev-mode only**; production needs Beacon wallet integration (Temple, Kukai) — not yet built.

### Reference client (commercial)

The platform creator's reference client is the commercial vehicle for sustainability. It:

- Has the best UX (this is the value proposition).
- Offers premium features for power users (archive export, analytics, multi-account redaction workflows for newsrooms).
- Is free for basic use; subscription for power features.

Third-party clients are free to implement any subset, with any business model. The protocol does not privilege the reference client.

### Onboarding UX target

A journalist signing up for the first time:

1. Enters email + phone (custodial wallet generated server-side, can be exported).
2. Completes BrightID verification (the friction step — must be made as smooth as possible).
3. Posts their first Bit.

This must take under 5 minutes. If it takes longer, the platform fails commercially. This is the single highest-stakes UX problem.

## 9. Economic Flow

```
User action ($X)
   │
   ├──> (1 - TreasuryFee)·X  →  Creator(s) / quorum stakers / burn (TBD per action type)
   └──> TreasuryFee·X         →  Treasury contract

BitNFT primary sale (price P)
   │
   ├──> (1 - BitNFTPrimaryFee)·P  →  Creators (split per RevenueSplit)
   └──> BitNFTPrimaryFee·P         →  Treasury

BitNFT secondary sale (price P)
   │
   ├──> (1 - RoyaltyBps - BitNFTSecondaryFee)·P  →  Seller
   ├──> RoyaltyBps·P                              →  Creators (split per RevenueSplit)
   └──> BitNFTSecondaryFee·P                      →  Treasury
```

`TreasuryAddress` is initially the platform creator. Migration to a DAO contract is expected long-term; the kernel does not presume which DAO model.

Open question: where do action fees actually flow *after* the TreasuryFee cut? Options: voted-on creators, quorum participants, burn. This is undecided in the current draft README and needs resolution.

## 10. Governance Flow

```
1. User creates Petition (costs PetitionCost)
2. Petition enters voting window (PetitionDuration)
3. Users cast PetitionVotes (each costs PetitionVoteCost)
4. At window close:
   - Check quorum (% of unique voters)
   - Check majority (% of cast votes)
   - If both met, the petition resolves and its effect is applied:
     • MOD_* → create/remove ModerationEntry
     • REM_* → signal removal + create MOD entry
     • VARIABLES → update kernel variable(s)
     • KERNEL → swap kernel contract code
```

Quorum and majority thresholds are themselves kernel variables. They differ by petition type:

- Content moderation: low threshold (% 1 quorum, % 50 majority)
- User moderation: slightly higher
- Variable change: high threshold (% 40 quorum, % 80 majority)
- Kernel replacement: very high threshold (% 50 quorum, % 90 majority)

This is intentionally a sliding scale: minor decisions should be easy, structural decisions should require broad consensus.

## 11. Security & Threat Model

### What we defend against

- **Spam / DoS**: per-action costs make spam economically unattractive.
- **Bots**: BrightID PoP at registration time; costs further raise the cost of botnets.
- **Sybil voting**: PoP plus quadratic vote costs mean buying outcomes is expensive at scale.
- **Impersonation**: signature checks at the client level catch any unsigned or wrongly-signed content.
- **Deepfakes**: not solved at the protocol level, but verifiable authorship gives readers a trust anchor.
- **Hostile moderation (small group taking over)**: high quorum thresholds for high-impact actions; low quorum for trivial ones.

### What we explicitly do NOT defend against

- **Determined adversaries re-hosting REM-ed content**: outside our scope.
- **A nation-state coercing a verified journalist into signing under duress**: cryptography cannot solve this.
- **A coordinated wealthy cabal manipulating votes**: costs help, quadratic mechanisms help, but at sufficient wealth they can buy outcomes. We treat this as a constitutional design tradeoff, not a bug.
- **Tezos L1 chain-level failure**: out of scope.

### Key-loss and account recovery

Open architectural question. Options:

- Social recovery (Tezos has libraries for this).
- Custodial key management in the reference client (with export).
- Hardware wallet for power users.

This must be solved before launch; key loss = identity loss = lost reputation.

## 12. Deployment Topology

### Phase 0 — Tezlink Shadownet (current)

- ✓ Variables (with bootstrap-admin pattern), Treasury, IdentityRegistry (with total_users counter), BitRegistry, PetitionRegistry (5 action types), ModerationRegistry — all live.
- ✓ BrightID is *placeholder* — accepts any 32-byte hash without signature verification.
- ✓ Reference client (`web/`) running locally with full feed, petitions, profile, moderation.
- ✓ Indexer + API in `docker-compose.yml`, schema in `db/migrations/`.
- Goal achieved: validated kernel contract correctness, governance flow end-to-end (passing + failing petitions), inter-contract calls (PetitionRegistry → Variables / ModerationRegistry on resolve).

### Phase 1 — Tezos X testnet (May–June 2026)

When the full Tezos X testnet stabilizes (Tezlink Shadownet is its Michelson layer; full EVM+Michelson testnet was announced for May 2026):

- Migrate contract origination targets to the Tezos X testnet RPC.
- Replace BrightID placeholder with real signature verification.
- Replace dev-only paste-key wallet with Beacon (Temple/Kukai) integration.
- Build SyndicateRegistry (Phase D) if needed for first real users.
- Build BitNFT FA2 (Phase E) for collectible monetization.
- Reference client beta with one partner organization (target: a small newsroom or research outlet).
- Public indexer, public verifier service for the partner.
- Goal: validate end-to-end UX with real users, refine onboarding.

### Phase 2 — Tezos X mainnet (Summer 2026+, after governance proposal)

- Production deployment.
- Reference client public release.
- Open verifier program (any organization can apply).
- Goal: vertical-focused growth in one segment (e.g. Norwegian political journalism, climate research, security research). Not horizontal expansion.

### Phase 3 — Federation and DAO transition

- Multiple independent indexers.
- Third-party clients.
- `TreasuryAddress` migration to a community DAO via petition.
- Goal: protocol becomes genuinely community-owned.

## 13. Open Architectural Questions

These need resolution before Phase 1:

- **Fee destination after TreasuryFee cut**: which actor receives the remainder? Creators of voted-up content? Quorum participants? Burned? Mixed? **Current MVP routes 100% to Treasury** as a simplification — the real distribution model is undecided.
- **Stablecoin denomination**: variables are currently denominated in mutez. README defaults are in `$`. Picking a stablecoin (USDt on Etherlink? kUSD? USDC bridge?) is a Phase E prerequisite for BitNFT royalty math.
- **Machine-generated content flag**: kernel-level boolean on Bit, or off-chain convention? AI summarizers (planned) need this.
- **Key recovery model**: social recovery vs. custodial vs. hybrid? Currently dev-paste-key. Beacon wallet covers some of this.
- **Bit content size limits**: what's the maximum size of a single Bit's content? Different limits for different content types? Currently unbounded.
- **Indexer-content-storage relationship**: do indexers run their own IPFS pinning, or rely on creators to keep content available? Currently API stores bytes in Postgres BYTEA.
- **Vote weight**: pure 1-user-1-vote, quadratic costs, or stake-weighted? Currently quadratic per-Bit; per-user vote weight is uniform.
- **REM_USER scope**: does it remove all the user's past Bits, or just block future ones? Current implementation: blocks all (their bits get filtered from feeds via `moderated_users` join).
- **Cross-jurisdictional moderation**: when EU indexers and US indexers disagree on what to serve, what is the user-facing experience?
- **Syndicate semantics**: advisory (label only) or enforced (BitRegistry verifies membership)? Decision blocks Phase D start.
- **KERNEL petition mechanics**: how does kernel replacement actually work? Proxy contract pattern with petition-triggered swap? Currently no implementation.

## 14. Non-Goals

So the scope is unambiguous:

- Politicus is **not** trying to replace X, Bluesky, or Mastodon for general-purpose social media.
- Politicus does **not** provide anonymous publishing. All content is signed.
- Politicus does **not** provide encrypted DMs. It is a publishing platform, not a messenger.
- Politicus does **not** opinionate on discovery, ranking, or recommendation algorithms. Those are client/indexer concerns.
- Politicus does **not** issue its own token. All economic units are denominated in a stablecoin on Tezos.
- Politicus is **not** a content-storage network. It relies on external content-addressable storage.
