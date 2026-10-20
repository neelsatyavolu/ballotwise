-- Midterms tracker: races each voter starred, and the dashboards Grok arranged for them.
-- race_id is civicAPI's race id.
CREATE TABLE midterm_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, race_id)
);

-- layout is JSON: { title, sections: [{ title, note, raceIds }] }.
CREATE TABLE midterm_dashboards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX midterm_dashboards_user ON midterm_dashboards (user_id, created_at);
