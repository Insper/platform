ALTER TABLE accounts.accounts
ADD COLUMN password_sha256 VARCHAR(64) NOT NULL;