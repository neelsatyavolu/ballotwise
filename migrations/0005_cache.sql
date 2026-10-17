-- Research shared across voters: a race looked up by one voter is reused for the next one with the same contest.
CREATE TABLE research_cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
