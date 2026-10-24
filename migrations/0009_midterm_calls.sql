-- Midterms tracker: every change our server has seen in a race's call, since civicAPI marks winners but gives no call time.
-- Append-only: a race's state is its latest event. race_id is civicAPI's race id; office is senate, house, governor or measure.
-- winner and party are NULL when a call was withdrawn; a race that was never called has no rows.
-- previous is the winner before this event (NULL for a first call, or a call after a withdrawal).
CREATE TABLE midterm_call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  office TEXT NOT NULL,
  winner TEXT,
  party TEXT,
  previous TEXT,
  observed_at INTEGER NOT NULL
);
CREATE INDEX midterm_call_events_race ON midterm_call_events (race_id, observed_at);

-- How far each recorder (calls, history) has processed civicAPI catalogs, by the catalog's fetch time.
-- Recorders skip any catalog fetched at or before this, so an older snapshot never writes over newer results.
CREATE TABLE midterm_ingest (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
