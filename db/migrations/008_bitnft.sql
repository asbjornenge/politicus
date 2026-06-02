CREATE TABLE nft_collections (
  address TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,
  owner_address TEXT,
  owner_sid TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX nft_collections_owner_address_idx ON nft_collections (owner_address);
CREATE INDEX nft_collections_owner_sid_idx ON nft_collections (owner_sid);

CREATE TABLE nft_editions (
  collection_address TEXT NOT NULL,
  token_id BIGINT NOT NULL,
  bid TEXT NOT NULL,
  total_editions BIGINT NOT NULL,
  mint_price BIGINT NOT NULL,
  royalty_bps INT NOT NULL,
  treasury_primary_bps INT NOT NULL,
  treasury_secondary_bps INT NOT NULL,
  sold BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_address, token_id)
);

CREATE INDEX nft_editions_bid_idx ON nft_editions (bid);
CREATE INDEX nft_editions_collection_idx ON nft_editions (collection_address);

CREATE TABLE nft_tokens (
  collection_address TEXT NOT NULL,
  token_id BIGINT NOT NULL,
  holder TEXT NOT NULL,
  balance BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_address, token_id, holder)
);

CREATE INDEX nft_tokens_holder_idx ON nft_tokens (holder);
CREATE INDEX nft_tokens_collection_token_idx ON nft_tokens (collection_address, token_id);
