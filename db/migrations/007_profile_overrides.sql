-- Allow ProfileRegistry JSON to override IdentityRegistry's username/bio for
-- users, and SyndicateRegistry's name/bio for syndicates. The indexer reads
-- the profile JSON when a profile bigmap update arrives and writes it into
-- the canonical row. We also store packed_key (Michelson pack of the address)
-- on users so the indexer can map a profile bigmap key back to a user.

ALTER TABLE users ADD COLUMN packed_key TEXT;
CREATE INDEX users_packed_key_idx ON users (packed_key);
