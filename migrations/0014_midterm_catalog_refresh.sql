-- When the last complete civicAPI refresh finished with D1 holding all its numbers. Snapshot rows are rewritten only
-- when a race's numbers change, so without this a fresh isolate can't tell a current catalog from an old one while
-- the counts sit still, and makes visitors wait on civicAPI. One row, only ever moved forward.
CREATE TABLE midterm_catalog_refresh (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at INTEGER NOT NULL
);
