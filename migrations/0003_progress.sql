-- Live progress written by background jobs: what is happening now and how many web searches it took.
ALTER TABLE ballots ADD COLUMN activity TEXT;
ALTER TABLE ballots ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ballots ADD COLUMN started_at INTEGER;
ALTER TABLE guides ADD COLUMN activity TEXT;
ALTER TABLE guides ADD COLUMN candidate_count INTEGER;
ALTER TABLE guides ADD COLUMN finished_at INTEGER;
