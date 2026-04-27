-- Store a secret reference instead of plaintext password.
-- Runtime resolves this name against Worker/CLI environment secrets.

ALTER TABLE politicians
ADD COLUMN IF NOT EXISTS stalwart_app_password_secret_name VARCHAR(255);

COMMENT ON COLUMN politicians.stalwart_app_password_secret_name IS
'Environment secret name containing the politician app password (e.g. POL_12_STALWART_APP_PASSWORD).';
