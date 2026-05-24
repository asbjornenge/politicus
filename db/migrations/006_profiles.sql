CREATE TABLE profiles (
  key TEXT PRIMARY KEY,
  profile_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
