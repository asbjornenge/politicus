CREATE TABLE indexer_state (
  source TEXT PRIMARY KEY,
  last_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  address TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  bio TEXT NOT NULL,
  brightid_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_username_idx ON users (username);

CREATE TABLE content (
  hash TEXT PRIMARY KEY,
  body BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bits (
  bid TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parent TEXT,
  syndicate TEXT,
  creation_time TIMESTAMPTZ NOT NULL,
  yay BIGINT NOT NULL DEFAULT 0,
  nay BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bits_creator_idx ON bits (creator);
CREATE INDEX bits_creation_time_desc_idx ON bits (creation_time DESC);
CREATE INDEX bits_parent_idx ON bits (parent) WHERE parent IS NOT NULL;
CREATE INDEX bits_content_hash_idx ON bits (content_hash);

CREATE TABLE votes (
  vid TEXT PRIMARY KEY,
  bid TEXT NOT NULL,
  voter TEXT NOT NULL,
  direction BOOLEAN NOT NULL,
  votes BIGINT NOT NULL,
  vote_time TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX votes_bid_idx ON votes (bid);
CREATE INDEX votes_voter_idx ON votes (voter);
