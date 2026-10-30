-- Push notifications for the iOS app. One row per device; no account needed.
-- environment is sandbox (development builds) or production (TestFlight and App Store); APNs keeps them apart.
-- alerts is JSON: { starred, control, allCalls, pollClose } booleans. starred is a JSON array of civicAPI race ids.
-- home_state is the voter's two-letter state, for poll-closing alerts; user_id links a signed-in device.
CREATE TABLE push_devices (
  token TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  alerts TEXT NOT NULL,
  starred TEXT NOT NULL,
  home_state TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The dispatcher's state. 'calls' holds the last call event id pushed (as at). 'polls:<time>' and 'control:<chamber>:<party>'
-- are one-time alerts, written once when sent; 'seen:control:...' is when a chamber first looked decided, so control
-- is only announced once it holds for two runs. 'jwt:<key id>' keeps the APNs provider token (value) and when it was
-- signed (at), since Apple rejects new tokens more often than every 20 minutes and cron runs land in fresh isolates.
CREATE TABLE push_sent (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  value TEXT
);
