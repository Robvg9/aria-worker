'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261103160000_voice_v4_telegram_message_delivery.sql'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'supabase/functions/_shared/telegram-message-delivery.mjs'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/aria-app-api-v3/index.ts'), 'utf8');
const pwa = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const router = fs.readFileSync(path.join(root, 'supabase/functions/_shared/voice-command-router.mjs'), 'utf8');
const setupDocs = fs.readFileSync(path.join(root, 'voice-v4/TELEGRAM-SETUP.md'), 'utf8');
assert.match(setupDocs, /ARIA_TELEGRAM_BOT_TOKEN/);
assert.match(setupDocs, /ARIA_TELEGRAM_OWNER_ID/);
assert.match(setupDocs, /Never put it in the PWA/i);
assert.match(setupDocs, /Use a dedicated bot exclusively for ARIA/i, 'Telegram polling must warn that discovery consumes every pending message update, not only /start');
assert.match(setupDocs, /highest_update_id \+ 1/i, 'Telegram operator docs must disclose the update acknowledgement boundary');

assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_message_recipients/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS aria_internal\.voice_message_dispatches/i);
assert.match(migration, /ALTER TABLE aria_internal\.voice_message_recipients ENABLE ROW LEVEL SECURITY/i);
assert.match(migration, /ALTER TABLE aria_internal\.voice_message_dispatches ENABLE ROW LEVEL SECURITY/i);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal\.voice_message_recipients FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /REVOKE ALL ON TABLE aria_internal\.voice_message_dispatches FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /UNIQUE\(owner_user_id, idempotency_key\)/i);
assert.match(migration, /body_sha256/);
assert.doesNotMatch(migration, /^\s*body\s+text\b/im, 'the raw message body must not be persisted');
assert.match(migration, /status = 'dispatching'/i, 'the dispatch claim must be an atomic state transition');
assert.match(migration, /status = 'prepared'/i);
assert.match(migration, /status IN \('prepared','dispatching','sent','failed','unknown','expired'\)/i,
  'the dispatch table must enumerate every supported state');
assert.match(migration, /SET status = p_status/i,
  'completion must persist only a terminal status validated by the RPC');

assert.match(adapter, /Deno\.env|botToken/);
assert.match(adapter, /\/sendMessage/);
assert.match(adapter, /protect_content: true/);
assert.match(adapter, /visible_authenticated_ui/);
assert.match(adapter, /telegram_delivery_outcome_uncertain/);
assert.match(adapter, /No automatic retry|no automatic retry/i);
assert.doesNotMatch(adapter, /console\.(log|error)\([^)]*token/i);

assert.match(api, /Deno\.env\.get\("ARIA_TELEGRAM_OWNER_ID"\)/);
assert.match(api, /\/voice\/messages\/telegram\/chats/);
assert.match(adapter, /getUpdates/);
assert.match(adapter, /configuredOwnerId/);
assert.match(adapter, /telegram_owner_mismatch/);
assert.match(api, /telegram_owner_mismatch/);
assert.match(migration, /claimed_for_send/);
assert.match(pwa, /Buscar chats que enviaron/);
assert.match(pwa, /session\.userId/);
assert.match(pwa, /Guardar destinatario/);
assert.match(api, /Deno\.env\.get\("ARIA_TELEGRAM_BOT_TOKEN"\)/);
assert.match(api, /\/voice\/messages\/recipients/);
assert.match(api, /\/voice\/messages\/confirm/);
assert.match(router, /prepareMessage/);
assert.match(router, /message_requires_explicit_recipient_and_content_confirmation/);
assert.match(pwa, /Enviar por Telegram/);
assert.match(pwa, /confirmPendingVoiceMessage/);
assert.match(pwa, /No se enviará nada hasta que pulses/);

console.log('ARIA VOICE V4 TELEGRAM MIGRATION AND API CONTRACT: PASS');
