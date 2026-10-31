-- A sign-in code in progress. The email code itself is not stored. Expires quickly; a finished connection lives in ddhq_connections.
CREATE TABLE ddhq_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sealed TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
