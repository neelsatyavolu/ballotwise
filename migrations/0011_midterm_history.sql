-- Midterms tracker: each race's numbers when any candidate's votes changed, so the tracker can show how a count moved.
-- Additions are sampled at most every 5 minutes; a leader change or a correction (any candidate's votes going down,
-- flagged in corrected) is recorded right away. votes is JSON {candidate name: votes}. margin is the leader's lead
-- over second place in points, from raw votes. reporting is NULL when civicAPI gave no reporting figure.
-- Uses midterm_ingest from 0009.
CREATE TABLE midterm_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  total INTEGER NOT NULL,
  votes TEXT NOT NULL,
  lead_name TEXT,
  lead_party TEXT,
  margin REAL,
  reporting REAL,
  corrected INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX midterm_history_race ON midterm_history (race_id, observed_at);
