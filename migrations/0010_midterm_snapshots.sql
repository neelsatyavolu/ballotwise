-- Each race's latest numbers from civicAPI, so a fresh isolate can show results while civicAPI is down and a race
-- civicAPI leaves out of an answer keeps its last numbers. One row per race, updated only by a newer fetch, so
-- isolates writing different races at once can't overwrite each other.
CREATE TABLE midterm_race_snapshots (
  race_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- Every race any isolate has seen in a civicAPI answer. Only ever added to (INSERT OR IGNORE), so no isolate's
-- write can make a race disappear from the tracker.
CREATE TABLE midterm_registry (
  race_id INTEGER PRIMARY KEY,
  office TEXT NOT NULL,
  state TEXT NOT NULL,
  district INTEGER,
  first_seen INTEGER NOT NULL
);
