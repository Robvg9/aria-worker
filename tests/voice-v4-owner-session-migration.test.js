'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20261102193000_voice_v4_owner_nonce_and_command_idempotency.sql'
);
const storagePath = path.join(
  root,
  'supabase/functions/aria-app-api-v3/voice-command-storage.ts'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const storage = fs.readFileSync(storagePath, 'utf8');
const router = fs.readFileSync(path.join(root, 'voice-v4/command-router.js'), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_owner_session_nonces/);
assert.match(migration, /PRIMARY KEY \(owner_user_id, nonce\)/,
  'the nonce must be atomically single-use per authenticated owner');
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_command_idempotency/);
assert.match(migration, /PRIMARY KEY \(owner_user_id, idempotency_key\)/,
  'idempotency must deduplicate the same owner command across devices');
assert.match(migration, /p_expires_at > now\(\) \+ interval '30 seconds'/,
  'server-side nonce expiry must be bounded to 30 seconds');
assert.match(migration, /p_idempotency_key !~ '\^\[A-Za-z0-9\._:-\]\+\$'/);
assert.match(migration, /ON CONFLICT \(owner_user_id, nonce\) DO NOTHING/);
assert.match(migration, /ON CONFLICT \(owner_user_id, idempotency_key\) DO NOTHING/);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path = aria_internal, pg_catalog/);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal\.voice_owner_session_nonces FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal\.voice_command_idempotency FROM PUBLIC, anon, authenticated/);
assert.match(migration, /TO service_role/);
assert.doesNotMatch(migration, /CREATE TABLE[^;]*(?:mission_id|job_id|raw_audio|transcript|speaker_template|message_body)/i,
  'direct command storage must never become an execution_jobs or mission queue');

assert.match(storage, /schema\("aria_internal"\)/);
assert.match(storage, /consume_voice_owner_session_nonce/);
assert.match(storage, /claim_voice_command_idempotency/);
assert.match(storage, /input\.ownerId !== authenticatedOwnerId/);
assert.match(storage, /new Date\(input\.expiresAt\)\.toISOString\(\)/);
assert.doesNotMatch(storage, /enqueue_execution_job_gateway|execution_jobs|mission_id|job_id|raw_audio|transcript|speaker_template/i,
  'the storage adapter must not enqueue mission/device jobs or retain voice content');

assert.match(router, /authenticatedOwnerId/);
assert.match(router, /expectedOwnerId: config\.ownerId/);
assert.match(router, /ownerId: config\.ownerId/);
assert.match(router, /operation: request\.operation/);

console.log('ARIA VOICE V4 OWNER NONCE + DIRECT COMMAND IDEMPOTENCY STORAGE CONTRACT: PASS');
