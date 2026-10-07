CREATE TABLE IF NOT EXISTS aria_internal.runtime_auth_token_hashes (
  token_name text PRIMARY KEY,
  token_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON aria_internal.runtime_auth_token_hashes FROM anon, authenticated;
GRANT SELECT ON aria_internal.runtime_auth_token_hashes TO service_role;

INSERT INTO aria_internal.runtime_auth_token_hashes(token_name,token_hash,active,updated_at)
SELECT 'aria_autonomy_cron_token',
       encode(digest(decrypted_secret,'sha256'),'hex'),
       true,
       clock_timestamp()
FROM vault.decrypted_secrets
WHERE name='aria_autonomy_cron_token'
ON CONFLICT (token_name) DO UPDATE
SET token_hash=excluded.token_hash,
    active=true,
    updated_at=clock_timestamp();
