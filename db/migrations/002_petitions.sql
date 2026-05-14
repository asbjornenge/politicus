CREATE TABLE petitions (
  pid TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  creation_time TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  yay BIGINT NOT NULL DEFAULT 0,
  nay BIGINT NOT NULL DEFAULT 0,
  unique_voters BIGINT NOT NULL DEFAULT 0,
  resolved BOOLEAN NOT NULL DEFAULT false,
  passed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX petitions_closes_at_idx ON petitions (closes_at);
CREATE INDEX petitions_resolved_idx ON petitions (resolved);
CREATE INDEX petitions_creator_idx ON petitions (creator);
