-- Xanom accounts (accounts.xanom.co) sign-in. xanom_sub is the Xanom account's OIDC subject, xanom_email the
-- address on that account (it can differ when someone links an existing Xanom account). An empty password_hash
-- means the account has no password and signs in through Xanom only.
ALTER TABLE users ADD COLUMN xanom_sub TEXT;
ALTER TABLE users ADD COLUMN xanom_email TEXT;
CREATE UNIQUE INDEX users_xanom_sub ON users(xanom_sub);

-- Set once Ballotwise knows the voter owns the address: a finished password reset or a Xanom sign-in.
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

-- One-time, 60-second tickets for the iOS app. `ios-session` hands the app its session after a Xanom sign-in;
-- `ios-start` carries the signed-in app user into the browser for link and convert.
CREATE TABLE xanom_tickets (
  ticket_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX xanom_tickets_expiry ON xanom_tickets(expires_at);
