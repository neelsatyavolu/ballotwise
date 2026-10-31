-- A user's Decision Desk HQ Votes session. The password is never stored.
-- sealed holds the Clerk client token and session id, encrypted the same way as an AI connection.
CREATE TABLE ddhq_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sealed TEXT NOT NULL,
  email TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
