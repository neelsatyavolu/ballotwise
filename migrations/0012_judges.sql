-- Ballots found before judges were covered get a one-time offer to look for just their judges.
-- New ballots are saved with 1, since their search already includes judges.
ALTER TABLE ballots ADD COLUMN judges_checked INTEGER NOT NULL DEFAULT 0;
