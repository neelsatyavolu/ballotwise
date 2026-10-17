-- The version of the Terms and Privacy Policy each user last accepted. Null until they accept.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
