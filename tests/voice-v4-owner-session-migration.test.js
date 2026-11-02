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
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_trusted_device_keys/);
assert.match(migration, /PRIMARY KEY \(owner_user_id, device_id\)/,
  'trusted device public keys must be owner-scoped');
assert.match(migration, /register_voice_trusted_device_key/);
assert.match(migration, /resolve_voice_trusted_device_key/);
assert.match(migration, /revoke_voice_trusted_device_key/);
assert.match(migration, /public_key_ed25519/);
assert.match(migration, /p_device_token/);
assert.match(migration, /token_hash = v_token_hash/);
assert.match(migration, /capabilities @> '\["audio\.wake_word"\]'::jsonb/);
assert.match(migration, /last_seen_at >= now\(\) - interval '90 seconds'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_speaker_model_catalog/);
assert.match(migration, /status = 'approved'/,
  'speaker verification can only use an approved server-side model');
assert.match(migration, /speaker model is not approved for production/);
assert.match(migration, /voice_speaker_model_catalog/);
assert.match(migration, /resolve_voice_speaker_policy/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\\.voice_device_commands/);
assert.match(migration, /enqueue_voice_device_command/);
assert.match(migration, /claim_voice_device_command/);
assert.match(migration, /complete_voice_device_command/);
assert.match(migration, /display\\.brightness\\.set/);
assert.match(migration, /app\\.open/);
assert.match(migration, /browser\\.open_url/);
assert.match(migration, /ON CONFLICT \\(owner_user_id, idempotency_key\\) DO NOTHING/);
assert.match(migration, /FOR UPDATE OF c SKIP LOCKED/);
assert.match(migration, /trusted owner-verified voice device unavailable/);
assert.match(migration, /command_id uuid PRIMARY KEY/);
const voiceQueueTable = migration.match(/CREATE TABLE IF NOT EXISTS aria_internal\\.voice_device_commands[\\s\\S]*?;/)?.[0] || '';
assert.ok(voiceQueueTable, 'direct device command table must exist');
assert.doesNotMatch(voiceQueueTable, /mission_id|job_id|shell\\.execute|message\\.send/i,
  'direct device queue must never contain a mission/job identifier, shell, or message send');

assert.match(migration, /revoke_voice_speaker_policy/);
assert.match(migration, /FOREIGN KEY/);
assert.match(migration, /evaluation_evidence_ref IS NOT NULL/);
assert.match(migration, /approved_at IS NOT NULL/);
assert.match(migration, /p_enabled IS TRUE AND NOT EXISTS/);

assert.doesNotMatch(migration, /speaker_embedding|voiceprint|raw_voice_sample|audio_blob/i,
  'no biometric template or audio may enter the database');
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
assert.match(storage, /register_voice_trusted_device_key/);
assert.match(storage, /resolve_voice_trusted_device_key/);
assert.match(storage, /revoke_voice_trusted_device_key/);
assert.match(storage, /resolve_voice_speaker_policy/);
assert.match(storage, /revoke_voice_speaker_policy/);
assert.match(storage, /registerTrustedDeviceKey/);
assert.match(storage, /resolveTrustedDeviceKey/);
assert.match(storage, /revokeTrustedDeviceKey/);
assert.match(storage, /setSpeakerPolicy/);
assert.match(storage, /resolveSpeakerPolicy/);
assert.match(storage, /revokeSpeakerPolicy/);
assert.match(storage, /requireUuid\(authenticatedOwnerId/);
assert.doesNotMatch(storage, /speaker_embedding|voiceprint|raw_voice_sample|private_key/i);

assert.match(storage, /input\.ownerId !== authenticatedOwnerId/);
assert.match(storage, /authenticated owner id/);
assert.match(storage, /input\.ownerId !== authenticatedOwnerId/);
assert.match(storage, /new Date\(input\.expiresAt\)\.toISOString\(\)/);
assert.doesNotMatch(storage, /enqueue_execution_job_gateway|execution_jobs|mission_id|job_id|raw_audio|transcript|speaker_template/i,
  'the storage adapter must not enqueue mission/device jobs or retain voice content');

assert.match(router, /authenticatedOwnerId/);
assert.match(router, /expectedOwnerId: config\.ownerId/);
assert.match(router, /ownerId: config\.ownerId/);
assert.match(router, /operation: request\.operation/);

console.log('ARIA VOICE V4 OWNER NONCE + DIRECT COMMAND IDEMPOTENCY STORAGE CONTRACT: PASS');
