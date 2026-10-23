#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the isolated CI PostgreSQL service}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.aria_vault_vaults (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vault_id uuid NOT NULL,
  PRIMARY KEY (owner_id, vault_id)
);
CREATE TABLE public.aria_vault_records (
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  record_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  format_version smallint NOT NULL DEFAULT 1 CHECK (format_version = 1),
  payload_nonce text NOT NULL CHECK (payload_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  ciphertext text NOT NULL CHECK (
    length(ciphertext) BETWEEN 22 AND 1398123
    AND ciphertext ~ '^[A-Za-z0-9_-]+$'
    AND length(ciphertext) % 4 <> 1
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, vault_id, record_id, revision),
  CONSTRAINT aria_vault_records_vault_owner_fk
    FOREIGN KEY (owner_id, vault_id)
    REFERENCES public.aria_vault_vaults(owner_id, vault_id)
    ON DELETE CASCADE
);
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.aria_vault_vaults(owner_id, vault_id)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
GRANT INSERT, SELECT ON TABLE public.aria_vault_records TO service_role;
INSERT INTO public.aria_vault_records(owner_id, vault_id, record_id, revision, format_version, payload_nonce, ciphertext)
VALUES ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333', 1, 1, 'AAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAAAA');
SQL

# Replay the exact registered migration sequence against an isolated disposable PostgreSQL instance.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261023033629_aria_encrypt_atomic_record_revisions.sql"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261023034057_aria_encrypt_revoke_direct_record_insert.sql"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261023040000_aria_encrypt_atomic_record_revisions.sql"

# The deployed server role must use the RPC; direct table INSERT must be denied.
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SET ROLE service_role; INSERT INTO public.aria_vault_records(owner_id,vault_id,record_id,revision,format_version,payload_nonce,ciphertext) VALUES ('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,2::bigint,1::smallint,'BBBBBBBBBBBBBBBB'::text,'BBBBBBBBBBBBBBBBBBBBBB'::text);" >"$tmpdir/direct-insert.log" 2>&1; then
  echo "FAIL: service_role unexpectedly has direct INSERT"
  exit 1
fi
grep -qi "permission denied" "$tmpdir/direct-insert.log"

# A sequential next revision succeeds through the RPC.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.aria_vault_append_record_revision_v1('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,2::bigint,1::smallint,'BBBBBBBBBBBBBBBB'::text,'BBBBBBBBBBBBBBBBBBBBBB'::text);"

# Two concurrent attempts for the same next revision must produce exactly one success
# and one deterministic revision_conflict, never two accepted writes or a unique-key race.
set +e
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.aria_vault_append_record_revision_v1('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,3::bigint,1::smallint,'CCCCCCCCCCCCCCCC'::text,'CCCCCCCCCCCCCCCCCCCCCC'::text);" >"$tmpdir/concurrent-a.log" 2>&1 &
pid_a=$!
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.aria_vault_append_record_revision_v1('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,3::bigint,1::smallint,'DDDDDDDDDDDDDDDD'::text,'DDDDDDDDDDDDDDDDDDDDDD'::text);" >"$tmpdir/concurrent-b.log" 2>&1 &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then
  grep -q "revision_conflict" "$tmpdir/concurrent-b.log"
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then
  grep -q "revision_conflict" "$tmpdir/concurrent-a.log"
else
  echo "FAIL: expected exactly one successful concurrent revision append"
  cat "$tmpdir/concurrent-a.log" "$tmpdir/concurrent-b.log"
  exit 1
fi

# Out-of-order revision 5 is rejected; the persisted revision sequence remains 1,2,3.
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.aria_vault_append_record_revision_v1('11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,5::bigint,1::smallint,'EEEEEEEEEEEEEEEE'::text,'EEEEEEEEEEEEEEEEEEEEEE'::text);" >"$tmpdir/out-of-order.log" 2>&1; then
  echo "FAIL: out-of-order revision was accepted"
  exit 1
fi
grep -q "revision_conflict" "$tmpdir/out-of-order.log"

sequence="$(psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "SELECT string_agg(revision::text, ',' ORDER BY revision) FROM public.aria_vault_records WHERE owner_id='11111111-1111-4111-8111-111111111111' AND vault_id='22222222-2222-4222-8222-222222222222' AND record_id='33333333-3333-4333-8333-333333333333';")"
[[ "$sequence" == "1,2,3" ]]

grants="$(psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "SELECT has_table_privilege('service_role','public.aria_vault_records','INSERT')::text || ',' || has_table_privilege('service_role','public.aria_vault_records','SELECT')::text || ',' || has_function_privilege('service_role','public.aria_vault_append_record_revision_v1(uuid,uuid,uuid,bigint,smallint,text,text)','EXECUTE')::text || ',' || has_function_privilege('anon','public.aria_vault_append_record_revision_v1(uuid,uuid,uuid,bigint,smallint,text,text)','EXECUTE')::text;")"
[[ "$grants" == "false,true,true,false" ]]

echo "PASS: atomic revisions, concurrency conflict, out-of-order rejection, and least-privilege grants verified in isolated PostgreSQL."
