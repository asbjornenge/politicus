-- Wipe stale Shadownet-indexed data before pointing the prod stack at
-- Tezos X Previewnet. Run this against the prod Postgres (pgmasterygg14)
-- AFTER stopping the indexer + api containers and BEFORE redeploying.
--
-- Keeps:
--   * content (IPFS cache — content_hash collisions are harmless; new bits
--     repopulate it as needed)
--   * schema migrations themselves (idempotent on next start)
--
-- Wipes:
--   * indexer_state — forces fresh bigmap cursors against new contracts
--   * users / bits / votes / petitions / petition_votes / syndicates /
--     syndicate_members / nft_* / profiles / issues / moderated_* — all
--     keyed against Shadownet contract addresses that are no longer in the
--     indexer config
--
-- Anyone who had a Shadownet profile must re-onboard on Previewnet
-- (new IdentityRegistry, fresh tz1 accounts).

BEGIN;

TRUNCATE TABLE
  indexer_state,
  users,
  bits,
  votes,
  petitions,
  petition_votes,
  syndicates,
  syndicate_members,
  nft_collections,
  nft_editions,
  nft_tokens,
  profiles,
  issues,
  moderated_content,
  moderated_users
RESTART IDENTITY CASCADE;

COMMIT;
