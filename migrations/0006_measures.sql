-- Ballot measures sit beside candidate contests. Level and kind sort each guide into a tab on My ballot.
ALTER TABLE guides ADD COLUMN level TEXT;
ALTER TABLE guides ADD COLUMN kind TEXT NOT NULL DEFAULT 'office';
