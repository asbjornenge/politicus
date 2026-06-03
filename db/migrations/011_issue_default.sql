ALTER TABLE issues ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS issues_is_default_idx ON issues (is_default, created_at DESC);
