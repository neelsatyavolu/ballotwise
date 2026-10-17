CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX password_resets_user ON password_resets(user_id);

-- Failed sign-ins and reset requests, keyed by a hash so no address is stored here.
CREATE TABLE attempts (
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attempts_key ON attempts(key_hash, created_at);

CREATE TABLE guides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  election_date TEXT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX guides_user ON guides(user_id, updated_at);
