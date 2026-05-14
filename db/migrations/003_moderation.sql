CREATE TABLE moderated_content (
  content_hash TEXT PRIMARY KEY,
  moderated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE moderated_users (
  address TEXT PRIMARY KEY,
  moderated_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
