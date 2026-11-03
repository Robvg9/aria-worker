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
const appApi = fs.readFileSync(path.join(root, 'supabase/functions/aria-app-api-v3/index.ts'), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_owner_session_nonces/);
assert.match(migration, /PRIMARY KEY [(]owner_user_id, nonce[)]/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_command_idempotency/);
assert.match(migration, /PRIMARY KEY [(]owner_user_id, idempotency_key[)]/);
assert.match(migration, /ON CONFLICT [(]owner_user_id, nonce[)] DO NOTHING/);
assert.match(migration, /ON CONFLICT [(]owner_user_id, idempotency_key[)] DO NOTHING/);
assert.match(migration, /interval '30 seconds'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_trusted_device_keys/);
assert.ok(migration.includes("CREATE UNIQUE INDEX IF NOT EXISTS voice_trusted_device_keys_single_owner_idx" + String.fromCharCode(10) + "  ON aria_internal.voice_trusted_device_keys (device_id);"),
  'a physical voice device must not be paired to multiple owner accounts');
assert.match(migration, /register_voice_trusted_device_key/);
assert.match(migration, /pair_voice_owner_device/);
assert.match(migration, /touch_voice_owner_device/);

assert.match(migration, /pair_voice_windows_owner_device/);
assert.match(migration, /touch_voice_windows_owner_device/);
assert.match(migration, /aria-windows-dpapi-ed25519-v1/);
const windowsPairFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.pair_voice_windows_owner_device'),
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.touch_voice_windows_owner_device')
);
assert.match(windowsPairFunction, /IS DISTINCT FROM 'windows-native'/);
assert.match(windowsPairFunction, /voice-v4-owner-readonly-v1/);
assert.match(windowsPairFunction, /public_key_fingerprint/);
assert.match(windowsPairFunction, /p_owner_user_id IS NULL/);
assert.match(windowsPairFunction, /pg_advisory_xact_lock/);
assert.match(windowsPairFunction, /wake_word_enabled/);
assert.ok(windowsPairFunction.includes("'[]'::jsonb"), 'Windows DPAPI pairing must grant no device actions');
assert.doesNotMatch(windowsPairFunction, /audio[.]wake_word/,
  'Windows owner pairing must not imply a wake-word or speaker verifier capability');
assert.match(windowsPairFunction, /v_key.revoked_at IS NOT NULL/);
const windowsTouchFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.touch_voice_windows_owner_device'),
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.revoke_voice_trusted_device_key')
);
assert.doesNotMatch(windowsTouchFunction, /audio[.]wake_word/);
assert.ok(windowsTouchFunction.includes("capabilities = '[]'::jsonb"),
  'Windows heartbeat must preserve zero capabilities');
assert.match(windowsTouchFunction, /d[.]status <> 'disabled'/,
  'Windows heartbeat must never reactivate an administratively disabled device');
assert.match(windowsTouchFunction, /d[.]token_hash = v_token_hash/);
assert.match(windowsTouchFunction, /k[.]owner_user_id = p_owner_user_id/);
assert.match(migration, /REVOKE ALL ON FUNCTION aria_internal[.]pair_voice_windows_owner_device/);
assert.match(migration, /REVOKE ALL ON FUNCTION aria_internal[.]touch_voice_windows_owner_device/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION aria_internal[.]pair_voice_windows_owner_device/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION aria_internal[.]touch_voice_windows_owner_device/);
assert.match(storage, /pairWindowsOwnerDeviceKey/);
assert.match(storage, /heartbeatWindowsOwnerDeviceKey/);
assert.match(storage, /internal[.]rpc[(]"pair_voice_windows_owner_device"/);
assert.match(storage, /internal[.]rpc[(]"touch_voice_windows_owner_device"/);
assert.ok(appApi.includes('path.endsWith("/voice/devices/pair-windows")'));
assert.ok(appApi.includes('path.endsWith("/voice/devices/heartbeat-windows")'));
assert.ok(appApi.includes('wake_word_enabled: false'));
assert.ok(appApi.includes('mode: "read_only"'));

assert.match(migration, /voice-v4-owner-readonly-v1/);
const pairedAndroidResolver = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_trusted_device_key'),
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.pair_voice_owner_device')
);
assert.doesNotMatch(pairedAndroidResolver, /audio[.]wake_word/,
  'a paired native Android identity may authenticate read-only sessions without wake-word permission');
const androidPairFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.pair_voice_owner_device'),
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.touch_voice_owner_device')
);
assert.match(androidPairFunction, /capabilities, metadata/);
assert.ok(androidPairFunction.includes("'[]'::jsonb"), 'pairing must create no device capabilities');
assert.match(androidPairFunction, /wake_word_enabled/);
assert.match(androidPairFunction, /p_owner_user_id IS NULL/);
assert.match(androidPairFunction, /IS DISTINCT FROM 'android-native'/);
assert.match(androidPairFunction, /v_key.revoked_at IS NOT NULL/);
assert.match(androidPairFunction, /pg_advisory_xact_lock/);
assert.match(migration, /REVOKE ALL ON FUNCTION aria_internal[.]pair_voice_owner_device/);
assert.match(migration, /REVOKE ALL ON FUNCTION aria_internal[.]touch_voice_owner_device/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION aria_internal[.]pair_voice_owner_device/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION aria_internal[.]touch_voice_owner_device/);
assert.match(storage, /pairOwnerDeviceKey/);
assert.match(storage, /heartbeatOwnerDeviceKey/);
assert.match(storage, /internal[.]rpc[(]"pair_voice_owner_device"/);
assert.match(storage, /internal[.]rpc[(]"touch_voice_owner_device"/);
assert.ok(appApi.includes('path.endsWith("/voice/devices/pair")'));
assert.ok(appApi.includes('path.endsWith("/voice/devices/heartbeat")'));
assert.ok(appApi.includes('wake_word_enabled: false'));
assert.ok(appApi.includes('mode: "read_only"'));
const androidTouchFunction = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.touch_voice_owner_device'),
  migration.indexOf('CREATE OR REPLACE FUNCTION aria_internal.revoke_voice_trusted_device_key')
);
assert.ok(androidTouchFunction.includes("capabilities = '[]'::jsonb"), 'heartbeat must preserve empty capabilities');
assert.match(androidTouchFunction, /d[.]status <> 'disabled'/, 'heartbeat must never reactivate an administratively disabled Android device');
assert.match(androidTouchFunction, /voice_trusted_device_keys/);
assert.match(androidTouchFunction, /d.token_hash = v_token_hash/);
assert.match(androidTouchFunction, /k.owner_user_id = p_owner_user_id/);
assert.match(migration, /resolve_voice_trusted_device_key/);
assert.match(migration, /revoke_voice_trusted_device_key/);
const registerTrustedVoiceDevice = migration.slice(
  migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.register_voice_trusted_device_key'),
  migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_trusted_device_key')
);
assert.ok(registerTrustedVoiceDevice.includes('DELETE FROM aria_internal.voice_trusted_device_keys'));
assert.ok(registerTrustedVoiceDevice.includes('owner_user_id <> p_owner_user_id'));
assert.ok(registerTrustedVoiceDevice.includes('enabled = false'));
assert.ok(registerTrustedVoiceDevice.includes('revoked_at IS NOT NULL'),
  'device ownership transfer must require revocation by the previous owner');
assert.match(migration, /public_key_ed25519/);
assert.match(migration, /token_hash = v_token_hash/);
assert.match(migration, /capabilities @> '\["audio[.]wake_word"\]'::jsonb/);
assert.match(migration, /last_seen_at >= now[(][)] - interval '90 seconds'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_speaker_model_catalog/);
assert.match(migration, /status = 'approved'/);
assert.match(migration, /speaker model is not approved or threshold is below its calibrated floor/);
assert.match(migration, /FOREIGN KEY [(]speaker_model_id[)]/);
assert.match(migration, /evaluation_evidence_ref IS NOT NULL/);
assert.match(migration, /approved_at IS NOT NULL/);
assert.match(migration, /resolve_voice_speaker_policy/);
assert.match(migration, /revoke_voice_speaker_policy/);
const latestSpeakerResolver = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.resolve_voice_speaker_policy'));
assert.match(latestSpeakerResolver, /JOIN aria_internal[.]voice_speaker_model_catalog m/);
assert.match(latestSpeakerResolver, /m[.]status = 'approved'/);

assert.match(latestSpeakerResolver, /m[.]approved_at IS NOT NULL/);
assert.match(latestSpeakerResolver, /m[.]evaluation_evidence_ref IS NOT NULL/);
assert.match(migration, /minimum_score_floor numeric[(]5,4[)] NOT NULL CHECK [(]minimum_score_floor > 0 AND minimum_score_floor <= 1[)]/);
assert.match(latestSpeakerResolver, /'minimumScore', GREATEST[(]p[.]minimum_score, m[.]minimum_score_floor[)]/i);
const latestSpeakerSetter = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.set_voice_speaker_policy'));
assert.match(latestSpeakerSetter, /p_minimum_score >= m[.]minimum_score_floor/,
  'owner policy cannot lower a speaker model below its server-calibrated threshold floor');

const voiceInternalTables = [
  'voice_owner_session_nonces',
  'voice_command_idempotency',
  'voice_trusted_device_keys',
  'voice_speaker_policies',
  'voice_speaker_model_catalog',
  'voice_device_commands'
];
for (const table of voiceInternalTables) {
  assert.ok(migration.includes(`ALTER TABLE aria_internal.${table} ENABLE ROW LEVEL SECURITY;`),
    `${table} must enforce deny-by-default RLS in the private schema`);
}
assert.match(migration, /GRANT SELECT ON TABLE aria_internal[.]voice_device_commands TO service_role/,
  'the authenticated status API needs the minimum direct SELECT grant; writes remain RPC-only');

// Guard against SQL corruption that static CI previously missed.
const sqlLines = migration.split(String.fromCharCode(10)).map(line => line.trim());
assert.equal(sqlLines.filter(line => line === 'BEGIN;').length, 1, 'migration must use one transaction opener');
assert.equal(sqlLines.filter(line => line === 'COMMIT;').length, 1, 'migration must use one transaction closer');
assert.equal(sqlLines.filter(line => line === 'AS $$' || line === 'DO $$').length,
  sqlLines.filter(line => line === '$$;').length,
  'every SQL/DO dollar-quoted body must have a matching terminator');
assert.ok(!sqlLines.includes('AS $') && !sqlLines.includes('$;'),
  'SQL function bodies must not use truncated dollar delimiters');
assert.match(migration, /CREATE OR REPLACE FUNCTION aria_internal[.]revoke_voice_trusted_device_key/);
assert.match(migration, /RAISE EXCEPTION 'owner and valid device ID are required'/);
assert.match(migration, /error_code = 'command_cancelled'/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal[.]voice_device_commands/);
assert.match(migration, /source_device_id text NOT NULL/);
assert.match(migration, /enqueue_voice_device_command/);
assert.match(migration, /p_source_device_id text/);
assert.match(migration, /claim_voice_device_command/);
assert.match(migration, /complete_voice_device_command/);
const latestDeviceRevoker = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.revoke_voice_trusted_device_key'));
assert.ok(latestDeviceRevoker.includes('UPDATE aria_internal.voice_trusted_device_keys'));
assert.ok(latestDeviceRevoker.includes('UPDATE aria_internal.voice_speaker_policies'));
assert.ok(latestDeviceRevoker.includes("SET enabled = false"));
assert.ok(latestDeviceRevoker.includes("status = 'cancelled'"));
assert.ok(latestDeviceRevoker.includes("error_code = 'command_cancelled'"),
  'revoking a device must disable its speaker policy and cancel queued actions');
assert.ok(migration.includes("status IN ('queued','claimed','running') AND expires_at <= now()"),
  'stale claimed/running commands must become terminal after their short TTL');
assert.ok(!migration.includes('jsonb_object_length'), 'command constraints must not depend on a nonexistent PostgreSQL function');
assert.match(migration, /params - 'brightness' = '\{\}'::jsonb/);
assert.match(migration, /params - 'app_id' = '\{\}'::jsonb/);
assert.match(migration, /params - 'url' = '\{\}'::jsonb/);
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
assert.match(storage, /getDeviceCommandStatus/);
assert.match(storage, /from\("voice_device_commands"\)/);
assert.match(storage, /eq\("owner_user_id", authenticatedOwnerId\)/);
assert.match(storage, /eq\("command_id", input[.]commandId\)/);
assert.match(storage, /allowedResultFields = new Set\(\["ok","brightness","app_id","opened","verified"\]\)/,
  'command status reads must not expose params or arbitrary result fields');
assert.match(storage, /createVoiceDeviceAgentQueue/);
assert.match(storage, /claim_voice_device_command/);
assert.match(storage, /complete_voice_device_command/);
const adapterResultFields = storage.match(/const allowed = new Set\(\[([^\]]+)\]\);/)?.[1] || '';
const sqlResultFields = migration.match(/WHERE item[.]key NOT IN \(([^)]+)\)/)?.[1] || '';
const quotedFields = (value) => [...value.matchAll(/"([^"]+)"|'([^']+)'/g)]
  .map((match) => match[1] || match[2]).sort();
assert.deepEqual(quotedFields(adapterResultFields), quotedFields(sqlResultFields),
  'TypeScript device result allowlist must exactly match the SQL completion allowlist');
assert.match(storage, /registerTrustedDeviceKey/);
assert.match(storage, /resolveTrustedDeviceKey/);
assert.match(storage, /revokeTrustedDeviceKey/);
assert.match(storage, /setSpeakerPolicy/);
assert.match(storage, /from\("voice_speaker_model_catalog"\)/);
assert.match(storage, /minimum_score_floor/);
assert.ok(storage.includes('.contains("supported_languages", ["es-CU"])'), 'speaker policy enrollment must filter to Cuban Spanish approved models');
assert.doesNotMatch(storage, /minimumScore: number/,
  'the API caller must not choose a weaker speaker threshold than the server-approved model floor');
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
assert.match(verifier, /export \{/);
assert.match(verifier, /export \{/);
assert.match(router, /deviceId: request[.]source_device_id/);
assert.match(router, /sourceDeviceId: request[.]source_device_id/);
assert.match(router, /authenticatedOwnerId/);
assert.match(router, /expectedOwnerId: config[.]ownerId/);
assert.match(router, /mission_execution_paused/);

assert.match(deviceGateway, /\/v1\/voice\/commands\/claim/);
assert.match(deviceGateway, /claim_voice_device_command/);
assert.match(deviceGateway, /\\\/v1\\\/voice\\\/commands\\\/\(\[0-9a-f\]\{8\}/);
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

const latestSpeakerEnqueue = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.enqueue_voice_device_command'), migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.claim_voice_device_command'));
const latestSpeakerClaim = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.claim_voice_device_command'), migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.complete_voice_device_command'));
const latestSpeakerComplete = migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION aria_internal.complete_voice_device_command'));
assert.ok(latestSpeakerResolver.includes("m.supported_languages @> ARRAY['es-CU']::text[]"), 'only models evaluated for Cuban Spanish may resolve');
assert.ok(latestSpeakerSetter.includes("m.supported_languages @> ARRAY['es-CU']::text[]"), 'speaker policy requires Cuban Spanish approval');
assert.ok(latestSpeakerEnqueue.includes("model.supported_languages @> ARRAY['es-CU']::text[]"), 'enqueue requires Cuban Spanish approval');
assert.ok(latestSpeakerClaim.includes("m.supported_languages @> ARRAY['es-CU']::text[]"), 'claim requires Cuban Spanish approval');
assert.ok(latestSpeakerComplete.includes("m.supported_languages @> ARRAY['es-CU']::text[]"), 'completion re-checks Cuban Spanish approval');
