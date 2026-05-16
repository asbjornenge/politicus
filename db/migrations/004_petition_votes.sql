CREATE TABLE petition_votes (
  pvid TEXT PRIMARY KEY,
  pid TEXT NOT NULL,
  voter TEXT NOT NULL,
  direction BOOLEAN NOT NULL,
  votes BIGINT NOT NULL,
  vote_time TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX petition_votes_pid_idx ON petition_votes (pid);
CREATE INDEX petition_votes_voter_idx ON petition_votes (voter);
