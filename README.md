# Curious Politicus (DRAFT)

Curious Politicus (CP or Politicus) is a social network and publishing platform.

*In more detail, you can say it is an attempt to create a proper incentive structure for a self-governing social media network that will lead to positive outcomes for humanity.*

**Politicus is not built to replace X, Bluesky or Mastodon.** It is aimed at journalists, writers, researchers and political activists — people for whom the *provenance* of a statement matters more than reach. The features below (signed content, costed actions, proof-of-personhood) are designed for that use case.

**On Politicus you will find only cryptographically signed content**.  
That means that for any [key]() you come to trust, it will not be possible for anyone else act on their behalf.

> Is that video signed by anyone you trust? If not, it might be a deepfake. 

**Actions on Politicus have a cost**.  
By adding a cost to all actions in Politicus we assure that actors weigh their actions and avoid unecessary noise. 
We also create a source of revenue for content creators.

**On Politicus all accounts are human beings (and there are no duplicates)**  
In order to create an account on CP a user needs to provide a *proof of personhood* via [BrightID](https://brightid.org/). BrightID uses a social graph (other verified humans attesting that you are a unique person) rather than biometrics, so no iris scan is required and the verification is not bound to your legal identity. This gives us: no bots, and no duplicates — without forcing users to reveal who they are.

**Identity is separate from personhood, and optional.**  
Proof-of-personhood says *"this key belongs to one real, unique person"*. It does **not** say who that person is. A user may *additionally* link their key to a verified real-world identity (e.g. a journalist proving they are the byline they claim to be) — but this is opt-in. Pseudonymous use is a first-class citizen, which matters for activists and writers operating under pressure.

**Moderation on Policitus is user controlled.**  
Users are in charge of [moderation](). Any user can petition for the removal of any piece of content or user.

**Politicus itself is user controlled.**  
Politicus has a "constitution"; it's [kernel](). The kernel has [variables](). Users can peition to change variables and also to replace the kernel.

**Politicus is free and open**  
Politicus source code is open-source and free to use by anyone.

**Politicus is built to last**  
Politicus is deployed as Michelson smart contracts on [Tezos X](https://tezos.com), which unifies EVM and Michelson on a single ledger. We do not run our own rollup — the platform's security and durability are inherited directly from Tezos L1, and the on-chain footprint is kept small by storing only hashes, signatures and votes (see "Where does the actual content live?" under Bit).

**The name Curious Politicus is inspired bt the 17th century newsbook Mercurious Politicus**  
[Mercurius Politicus](https://en.wikipedia.org/wiki/Mercurius_Politicus) was a newsbook that was published weekly from June 1650 until the English Restoration in May 1660.
We replaced the latin word Mercurious (messenger) and substitud the english word Curious. Politicus is a latin word for "political". We also take inspiration from the greek concept of "polis" which represented a self-governing community with its laws, institutions, and identity. So loosely you can say the the name "Curious Politicus" means "Curious about self-governing communities" or something like that. Also we think it is quite catchy.

## User

A **User** is an individual, a human being in the universe, that is using Politicus. Users need to provide a "proof of personhood" from the [Worldcoin](https://worldcoin.org/) project in order to be able to use CP.

A User has the following properties:

```
* UID         - PublicKey
* UserName    - String
* Bio         - Text
* Verified    - Optional<VerificationClaim>  (linked real-world identity, opt-in)
```

The `Verified` field is empty for pseudonymous users. When present, it contains a signed claim from a trusted verifier (e.g. a press organisation vouching that this key belongs to a known journalist). Clients can display a badge accordingly. Pseudonymous users are not second-class — they can do everything verified users can do.

## Syndicate

A **Syndicate** is an association of **Users** working together on a shared project.

A Syndicate has the following properties.

```
* SID         - String (Randomly generated?)
* Creator     - PublicKey
* Name        - String
* Description - String
* Associates  - List<PublicKey>
```

## Bit

A **Bit** is a piece of content on Politicus. We chose the word "Bit" because it is short, easy to say and remember.

> I just posted a Bit on Politicus.

A Bit has the following properties:

```
* BID           - hash(Creators + Content)
* Creators      - List<PublicKey>
* Content       - hash(content)
* Parent        - BID (if this BID is part of a conversation)
* Syndicate     - SID (if this BID is posted from a syndicate)
* CreationTime  - Timestamp
```

### Where does the actual content live?

**Only the hash of the content is stored on-chain.** The bytes themselves (text, images, video) live off-chain — in content-addressed storage such as IPFS, on dedicated indexer nodes, or on the creator's own host. Clients fetch the bytes, verify the hash matches the on-chain `Content` field, and verify the signature against `Creators`.

This separation is what makes moderation possible at all. The blockchain is immutable — you can never *delete* something from chain history. But:

- The on-chain record is just *proof* (hashes, signatures, votes, petitions).
- The actual content can be removed from indexers and gateways when a `REM_CONTENT` petition succeeds.
- The hash remains on chain forever, but without anyone hosting the bytes it cannot be reconstructed.

This also gives us a workable answer to GDPR's right-to-be-forgotten and to illegal content: compliant indexers refuse to serve the bytes, and the cryptographic record is reduced to a meaningless hash.

A determined adversary can of course re-host removed content. This is true of all internet content and is not a problem Politicus claims to solve.

## BitVote

A BitVote is a up/down vote for a Bit.

```
* VID       - hash(BID + Voter)
* Voter     - PublicKey
* Direction - Boolean (1=up, 0=down)
* Votes     - Number of votes (quadratic cost increase?)
* VoteTime  - Timestamp
```

## BitNFT

Optionally, a Bit may be minted as an [FA2](https://tzip.tezosagora.org/proposal/tzip-12/) token by its Creators. This lets journalists, writers and other authors sell editions of their work as collectibles — "novelties" or "first editions" — to readers who want to support them or hold a piece of provenance.

Because every Bit is already cryptographically signed by its `Creators`, a BitNFT is not just a token pointing at some bytes — it is a signed original work with built-in proof of authorship. That is exactly what collectors care about, and it is something the rest of the NFT world has to bolt on after the fact.

**Key properties:**

* Tokenization is **opt-in** per Bit, decided by the Creator(s) at mint time.
* The content remains **freely readable to everyone**. The hash is public, the bytes are mirrored off-chain. Owning a BitNFT does **not** gate access — it confers provenance, not exclusivity. This is deliberate: Politicus is free and open, the NFT layer sits *on top* as a patronage and collectible mechanism.
* Editions can be 1-of-1, a limited series (e.g. 1 of 50), or an open edition.
* Primary-sale revenue is split among the Bit's `Creators` according to a configurable split.
* Secondary-sale royalties (FA2-native) flow back to `Creators` in perpetuity.
* If a Bit is REM-moderated, the token continues to exist as historical record, but compliant indexers stop serving the underlying bytes. Holders retain a signed hash but not the content. Buyers should be aware of this risk before purchasing.

A BitNFT has the following properties:

```
* TID           - hash(BID + EditionNumber)
* BID           - The Bit being tokenized
* EditionNumber - Number (1..N for limited, 0 for open editions)
* TotalEditions - Number (N for limited, 0 for open)
* MintPrice     - $ amount at primary sale
* RoyaltyBps    - Basis points (e.g. 500 = 5%) returned to Creators on secondary sale
* RevenueSplit  - Map<PublicKey, Bps> over Creators
```

Standard FA2 transfer, balance and operator semantics apply.

### Patrons

BitNFT ownership doubles as an organic signal of patronage. For each User, indexers and clients can derive a list of *patrons*: the users who collectively hold the largest number of editions of that author's work. The author's profile may surface their top patrons as a badge, and patrons may surface the authors they support.

This is intentionally a derived view, not a separate on-chain object — it falls out of the FA2 ownership graph for free. It encourages real fan-relationships (you support the work you actually value) rather than vanity metrics.

Caveats worth being honest about:

* It is gameable — a wealthy user can buy their way to "top patron" status. The point is not to be ungameable, but to make support visible and meaningful at the margin.
* It is a *client/indexer* feature, not a kernel rule. Different clients may surface it differently, or not at all.

## Petiton

A Petiton is a request to change some aspect of CP. There are a few different types of petitions.

```
* PID           - hash(content)
* Type          - ENUM 
                (
                    + MOD_SYNDICATE_ADD - Add ModerationEntry for a Syndicate 
                    + MOD_SYNDICATE_DEL - Del ModerationEntry for a Syndicate
                    + MOD_CONTENT_ADD   - Add ModerationEntry for a piece of content
                    + MOD_CONTENT_DEL   - Del ModerationEntry for a piece of content
                    + MOD_USER_ADD      - Add ModerationEntry for a User
                    + MOD_USER_DEL      - Del ModerationEntry for a User
                    + REM_SYNDICATE     - Remove a Syndicate (and all their Bits)
                    + REM_CONTENT       - Remove a piece of content
                    + REM_USER          - Remove a User (and all their Bits)
                    + VARIABLES         - Modify variable(s)
                    + KERNEL            - Update kernel
                )
* Creator       - PublicKey
* Content       - <JSON_MATCHING_ENUM> 
* CreationTime  - Timestamp
```

## PetitionVote

A PetitionVote is a up/down vote for a Petition.

```
* PVID      - hash(PID + Voter)
* Voter     - PublicKey
* Direction - Boolean (1=up, 0=down)
* Votes     - Number of votes (quadratic cost increase?)
* VoteTime  - Timestamp
```

## ModerationEntry

When a Petition to create some form of moderation (Content or User) a ModerationEntry is created.
The ModerationEntry prevents moderated content from being created and moderated users from using CP. 

```
* MID           - hash(content)
* Type          - ENUM
                (
                    + SYNDICATE
                    + CONTENT
                    + USER
                )
* Content       - <JSON_MATCHING_ENUM> 
* YaY           - Number of UP votes
* NaY           - Number of DOWN votes
* CreationTime  - Timestamp
```

## Variables

The different variables in the initial kernel / constitution.

```
* BitCost                                   - $ 0.10
* BitVoteCost                               - $ 0.05  (quadratic)
* PetitionContentModerationAddCost          - $ 100
* PetitionContentModerationDelCost          - $ 50   (function if already exists)
* PetitionUserModerationAddCost             - $ 250
* PetitionUserModerationDelCost             - $ 125  (function if already exists)
* PetitionUpdateVariableCost                - $ 500
* PetitionUpdateKernelCost                  - $ 1000
* PetitionVoteCost                          - $ 0.25 (quadratic)
* PetitionContentModerationQuorum           - % 1
* PetitionUserModerationQuorum              - % 2
* PetitionUpdateVariableQuorum              - % 40
* PetitionUpdateKernelQuorum                - % 50
* PetitionContentModerationMajority         - % 50
* PetitionUserModerationMajority            - % 50
* PetitionUpdateVariableMajority            - % 80
* PetitionUpdateKernelMajority              - % 90
* PetitionDuration                          - d 30
```

## Kernel 

## Incentives

* Incentives to create Bits
* Incentives to vote on Bits
* Incentives to create Petitions
* Incentives to vote on Petitions

## Moderation

There are two types of moderation; `MOD` and `REM`.

### MOD

**MOD** creates a ModerationEntry in storage and there are 3 types;

```
MOD_SYNDICATE - Block a Syndicate from creating further content on Politicus
MOD_CONTENT   - Block a specific piece of content from being created again
MOD_USER      - Block a User from creating further content on Politicus
```

MODs can be added and removed (lifted).

`MOD_CONTENT` has a few caveats. 

A User can create a Bit with the content `<BAD_WORD>`, this can be moderated. But then the user can just create a new Bit with the content `<BAD_WORD>.` and it will not be blocked. In this case it is perhaps better to petition for MOD_USER or REM_USER for the violating User.

The same would be true for an offensive image ^. A User could just modify a single bit of the image and it would not be moderated. In this case also the solution would be to petition for MOD_USER or REM_USER.

We still think it is useful to keep `MOD_CONTENT` as an option.

### REM

**REM** removes Users, Syndicates or Content from Politicus and there are 3 types;

```
REM_SYNDICATE - Removes a Syndicate from creating further content on Politicus
REM_CONTENT   - Removes a specific piece of content from politicus
REM_USER      - Removes a User from creating further content on Politicus
```

For REM_SYNDICATE and REM_USER a MOD_SYNDICATE and MOD_USER moderation entry is create also.

**What "removal" actually means.** Since the chain is immutable, REM does not erase the on-chain record. It signals to compliant indexers and gateways that they must stop serving the off-chain bytes that the on-chain hash refers to. The signature and hash remain on chain as historical record; the content itself becomes unreachable through the canonical network. See the "Where does the actual content live?" section under Bit.

## Open questions

### How do we deal with bots?

BrightID's social-graph verification gives us proof-of-personhood without biometrics. Combined with the per-action cost, this should keep bots out at the platform level. Open question: how do we handle a verified human who runs an automated agent under their own key?

### How do we deal with "copyminting"?

If a user believes he owns the rights to the `content` of a Bit, they can create a petition to have it removed.
They can then create it themselves. The user can also petition to have the copyminter (user who created bit illegally) blocked or removed.

### How do we deal with fake content?

### How do we deal with illegal content?

The off-chain storage model (see Bit section) lets compliant indexers refuse to serve illegal content even though the hash remains on chain. Open question: who is "the" canonical indexer, and what is the legal posture of running one in different jurisdictions?

### How do we handle topics / hashtags

CP itself does not parse, link or otherwize deal with topics or hashtags. That is a job for indexers.

## Notes

* After a petition has been voted for, how long until it can be re-created? A variable?
* Should we allow blank votes?
* Instead of petition votes having a cost, should votes be earned? By creating Bits that gets high number of votes?
* What happends if a BIT parent is removed? Just treat it as an orphan?
* Add missing variables for REM_
* Do we need REM_SYNDICATE ?
* Does MOD_USER_ADD not imply removing all their Bits? I think not...
