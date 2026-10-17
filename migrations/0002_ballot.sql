-- Grok connections live server-side so research can run in the background. Tokens are AES-GCM sealed.
CREATE TABLE grok_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sealed TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One saved address per account and the districts the Census geocoder matched it to.
CREATE TABLE ballots (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  matched_address TEXT NOT NULL,
  districts TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  updated_at INTEGER NOT NULL
);

-- Guides found from a ballot are researched in the background: status is queued, researching, ready or failed.
ALTER TABLE guides ADD COLUMN origin TEXT NOT NULL DEFAULT 'search';
ALTER TABLE guides ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE guides ADD COLUMN voted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guides ADD COLUMN error TEXT;
ALTER TABLE guides ADD COLUMN query TEXT;
ALTER TABLE guides ADD COLUMN election_name TEXT;

-- Each candidate's background research is its own row, so parallel jobs never overwrite each other.
CREATE TABLE guide_profiles (
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  data TEXT,
  error TEXT,
  PRIMARY KEY (guide_id, candidate_id)
);
