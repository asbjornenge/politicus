CREATE TABLE syndicates (
  sid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT NOT NULL,
  creator TEXT NOT NULL,
  creation_time TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX syndicates_name_idx ON syndicates (name);
CREATE INDEX syndicates_creator_idx ON syndicates (creator);

CREATE TABLE syndicate_members (
  sid TEXT NOT NULL,
  address TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sid, address)
);

CREATE INDEX syndicate_members_address_idx ON syndicate_members (address);
CREATE INDEX syndicate_members_sid_idx ON syndicate_members (sid);
