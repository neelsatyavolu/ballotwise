-- The values interview: the conversation so far and, once finished, the summary used to pre-fill answers.
CREATE TABLE voter_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  summary TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Answers inferred from the interview for this race's issues. The voter's own answers in `data` take precedence per issue.
ALTER TABLE guides ADD COLUMN suggested TEXT;
-- Set once the interview has been queued for mapping onto this guide, so repeated saves don't queue it again.
ALTER TABLE guides ADD COLUMN align_requested INTEGER NOT NULL DEFAULT 0;
