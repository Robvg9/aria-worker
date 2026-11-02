'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(
  root,
  'supabase/migrations/20261102193000_voice_v4_owner_nonce_and_command_idempotency.sql'
), 'utf8');
const storage = fs.readFileSync(path.join(
  root,
  'supabase/functions/aria-app-api-v3/voice-command-storage.ts'
), 'utf8');
const router = fs.readFileSync(path.join(root, 'supabase/functions/_shared/voice-command-router.mjs'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'supabase/functions/_shared/voice-owner-session-verifier.mjs'), 'utf8');
const deviceGateway = fs.readFileSync(path.join(root, 'supabase/functions/aria-device-gateway/index.ts'), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_owner_session_nonces/);
assert.match(migration, /PRIMARY KEY [(]owner_user_id, nonce[)]/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_command_idempotency/);
assert.match(migration, /PRIMARY KEY [(]owner_user_id, idempotency_key[)]/);
assert.match(migration, /ON CONFLICT [(]owner_user_id, nonce[)] DO NOTHING/);
assert.match(migration, /ON CONFLICT [(]owner_user_id, idempotency_key[)] DO NOTHING/);
assert.match(migration, /interval '30 seconds'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_trusted_device_keys/);
assert.match(migration, /register_voice_trusted_device_key/);
assert.match(migration, /resolve_voice_trusted_device_key/);
assert.match(migration, /revoke_voice_trusted_device_key/);
assert.match(migration, /public_key_ed25519/);
assert.match(migration, /token_hash = v_token_hash/);
assert.match(migration, /capabilities @> '\["audio[.]wake_word"\]'::jsonb/);
assert.match(migration, /last_seen_at >= now[(][)] - interval '90 seconds'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_speaker_model_catalog/);
assert.match(migration, /status = 'approved'/);
assert.match(migration, /speaker model is not approved for production/);
assert.match(migration, /FOREIGN KEY [(]speaker_model_id[)]/);
assert.match(migration, /evaluation_evidence_ref IS NOT NULL/);
assert.match(migration, /approved_at IS NOT NULL/);
assert.match(migration, /resolve_voice_speaker_policy/);
assert.match(migration, /revoke_voice_speaker_policy/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_device_commands/);
assert.match(migration, /source_device_id text NOT NULL/);
assert.match(migration, /enqueue_voice_device_command/);
assert.match(migration, /p_source_device_id text/);
assert.match(migration, /claim_voice_device_command/);
assert.match(migration, /complete_voice_device_command/);
assert.match(migration, /jsonb_object_length[(]params[)] = 1/);
assert.match(migration, /display[.]brightness[.]set/);
assert.match(migration, /app[.]open/);
assert.match(migration, /browser[.]open_url/);
assert.match(migration, /FOR UPDATE OF c SKIP LOCKED/);
assert.match(migration, /trusted owner-verified voice device unavailable/);
assert.match(migration, /voice_trusted_device_keys source_key/);
assert.match(migration, /voice_speaker_policies source_policy/);
assert.match(migration, /source_device_id/);
const voiceQueueTable = migration.match(/CREATE TABLE IF NOT EXISTS aria_internal[.]voice_device_commands[\s\S]*?;/)?.[0] || '';
assert.ok(voiceQueueTable, 'direct device command table must exist');
assert.doesNotMatch(voiceQueueTable, /mission_id|job_id|shell[.]execute|message[.]send/i,
  'direct device queue must not become a mission, shell, or messaging queue');

assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path = aria_internal, pg_catalog/);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal[.]voice_owner_session_nonces FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal[.]voice_command_idempotency FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal[.]voice_device_commands FROM PUBLIC, anon, authenticated/);
assert.match(migration, /TO service_role/);
const schemaStatements = migration
  .replace(/--[^\n]*/g, '')
  .replace(/COMMENT ON (?:TABLE|COLUMN)\b[\s\S]*?;/gi, '');
assert.doesNotMatch(schemaStatements, /speaker_embedding|voiceprint|raw_voice_sample|audio_blob/i,
  'no biometric template or audio columns/tables may be stored in Supabase');

assert.match(storage, /schema[(]"aria_internal"[)]/);
assert.match(storage, /consume_voice_owner_session_nonce/);
assert.match(storage, /claim_voice_command_idempotency/);
assert.match(storage, /enqueue_voice_device_command/);
assert.match(storage, /createVoiceDeviceAgentQueue/);
assert.match(storage, /claim_voice_device_command/);
assert.match(storage, /complete_voice_device_command/);
const adapterResultFields = storage.match(/const allowed = new Set\\(\\[([^\\]]+)\\]\\);/)?.[1] || '';
const sqlResultFields = migration.match(/WHERE item[.]key NOT IN \\(([^)]+)\\)/)?.[1] || '';
const quotedFields = (value) => [...value.matchAll(/"([^"]+)"|'([^']+)'/g)]
  .map((match) => match[1] || match[2]).sort();
assert.deepEqual(quotedFields(adapterResultFields), quotedFields(sqlResultFields),
  'TypeScript device result allowlist must exactly match the SQL completion allowlist');
assert.match(storage, /registerTrustedDeviceKey/);
assert.match(storage, /resolveTrustedDeviceKey/);
assert.match(storage, /revokeTrustedDeviceKey/);
assert.match(storage, /setSpeakerPolicy/);
assert.match(storage, /resolveSpeakerPolicy/);
assert.match(storage, /revokeSpeakerPolicy/);
assert.match(storage, /sourceDeviceId/);
assert.match(storage, /p_source_device_id/);
assert.match(storage, /requireUuid[(]authenticatedOwnerId/);
assert.match(storage, /input[.]ownerId !== authenticatedOwnerId/);
const executableStorage = storage
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(executableStorage, /execution_jobs|enqueue_execution_job_gateway|mission_id|job_id|raw_audio|transcript|speaker_template|private_key/i,
  'service adapters must not queue missions or store voice/private key material');

assert.match(router, /source_device_id/);
assert.match(verifier, /export \\{/);
assert.match(verifier, /createOwnerSessionVerifier/);
assert.match(router, /deviceId: request[.]source_device_id/);
assert.match(router, /sourceDeviceId: request[.]source_device_id/);
assert.match(router, /authenticatedOwnerId/);
assert.match(router, /expectedOwnerId: config[.]ownerId/);
assert.match(router, /mission_execution_paused/);

assert.match(deviceGateway, /\/v1\/voice\/commands\/claim/);
assert.match(deviceGateway, /claim_voice_device_command/);
assert.match(deviceGateway, /\/v1\/voice\/commands\/\(\[0-9a-f\]\{8\}/);
assert.match(deviceGateway, /complete_voice_device_command/);
assert.match(deviceGateway, /p_device_token:voiceDeviceToken/);
const deviceGatewayAuth = deviceGateway.indexOf("const a=await auth(req,b.device_id)");
const voiceQueueClaimRoute = deviceGateway.indexOf("p==='/v1/voice/commands/claim'");
const voiceQueueCompleteRoute = deviceGateway.indexOf("voiceCompleteMatch");
assert.ok(deviceGatewayAuth >= 0 && voiceQueueClaimRoute > deviceGatewayAuth && voiceQueueCompleteRoute > deviceGatewayAuth,
  'voice command agent endpoints must remain behind authenticated device token validation');
const voiceAgentQueueRoutes = deviceGateway.slice(voiceQueueClaimRoute, deviceGateway.indexOf("if(req.method==='POST'&&p==='/v1/meditation/tick')", voiceQueueClaimRoute));
assert.doesNotMatch(voiceAgentQueueRoutes, /execution_jobs|executionJobGatewayCall|mission_id|job_id/i,
  'direct voice agent queue must remain separate from mission execution_jobs');

console.log('ARIA VOICE V4 OWNER, DEVICE KEY, SPEAKER POLICY + DIRECT QUEUE CONTRACT: PASS');
