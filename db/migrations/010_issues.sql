CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  intro TEXT,
  layout_json JSONB NOT NULL,
  bit_ids JSONB NOT NULL,
  time_window_start TIMESTAMPTZ NOT NULL,
  time_window_end TIMESTAMPTZ NOT NULL,
  filter_query TEXT,
  filter_syndicate TEXT,
  creator TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX issues_created_at_idx ON issues (created_at DESC);
CREATE INDEX issues_creator_idx ON issues (creator);
