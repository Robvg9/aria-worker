'use strict';

const assert = require('node:assert/strict');
let createTelegramMessageDelivery;

function fixture({ token = '123456:TelegramFakeBotToken_forContractTests', fetchImpl } = {}) {
  const sent = [];
  const completions = [];
  const rows = new Map();
  const recipient = {
    recipient_id: 'contact-mom',
    display_name: 'Mamá',
    telegram_chat_id: '123456789',
    enabled: true
  };
  const stores = {
    async getTelegramRecipient(id) {
      return id === recipient.recipient_id ? recipient : null;
    },
    async prepareTelegramDispatch(input) {
      assert.equal(Object.hasOwn(input, 'body'), false, 'message body must not be persisted');
      const row = {
        confirmation_id: input.confirmationId,
        owner_id: input.ownerId,
        idempotency_key: input.idempotencyKey,
        recipient_id: input.recipientId,
        body_sha256: input.bodyHash,
        status: 'prepared',
        expires_at: new Date(input.expiresAt).toISOString()
      };
      rows.set(input.confirmationId, row);
      return { confirmation_id: row.confirmation_id, status: 'prepared', expires_at: row.expires_at };
    },
    async claimTelegramDispatch(input) {
      const row = rows.get(input.confirmationId);
      if (!row || row.owner_id !== input.ownerId || row.body_sha256 !== input.bodyHash) return null;
      if (row.status === 'sent') return { status: 'sent', provider_message_id: row.provider_message_id };
      if (row.status !== 'prepared') return { status: row.status };
      row.status = 'dispatching';
      return { status: 'dispatching', recipient_id: row.recipient_id, telegram_chat_id: recipient.telegram_chat_id };
    },
    async completeTelegramDispatch(input) {
      const row = rows.get(input.confirmationId);
      if (!row || row.status !== 'dispatching') return false;
      row.status = input.status;
      row.provider_message_id = input.providerMessageId ?? null;
      completions.push({ ...input });
      return true;
    }
  };
  const delivery = createTelegramMessageDelivery({
    botToken: token,
    stores,
    fetchImpl: fetchImpl || (async (url, init) => {
      sent.push({ url, init, parsedBody: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, result: { message_id: 77, chat: { id: 123456789 } } };
        }
      };
    }),
    now: () => 1793644447000,
    randomUUID: () => '123e4567-e89b-42d3-a456-426614174100'
  });
  return { delivery, stores, sent, completions, rows };
}

(async () => {
  ({ createTelegramMessageDelivery } = await import('../supabase/functions/_shared/telegram-message-delivery.mjs'));
  const unconfigured = fixture({ token: '' });
  const blocked = await unconfigured.delivery.prepare({
    ownerId: 'owner-uuid',
    recipientId: 'contact-mom',
    body: 'Te quiero.',
    idempotencyKey: 'voice-idem-key-000001'
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'telegram_provider_not_configured');
  assert.equal(unconfigured.sent.length, 0);

  const fx = fixture();
  const preview = await fx.delivery.prepare({
    ownerId: 'owner-uuid',
    recipientId: 'contact-mom',
    body: 'Te quiero.',
    idempotencyKey: 'voice-idem-key-000001'
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.recipient_name, 'Mamá');
  assert.equal(preview.body, 'Te quiero.');
  assert.match(preview.confirmation_id, /^[0-9a-f-]{36}$/i);
  assert.equal(fx.sent.length, 0, 'preparing a message must not send it');
  const stored = fx.rows.get(preview.confirmation_id);
  assert.equal(stored.body_sha256.length, 64);
  assert.equal(Object.hasOwn(stored, 'body'), false, 'the database row carries only a body digest');

  const result = await fx.delivery.confirm({
    ownerId: 'owner-uuid',
    confirmationId: preview.confirmation_id,
    body: preview.body
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'sent');
  assert.equal(result.executed, true);
  assert.equal(result.provider_message_id, 77);
  assert.equal(fx.sent.length, 1, 'only the explicit confirmation performs the Telegram call');
  assert.match(fx.sent[0].url, /^https:\/\/api\.telegram\.org\/bot123456:/);
  assert.equal(fx.sent[0].parsedBody.chat_id, '123456789');
  assert.equal(fx.sent[0].parsedBody.text, 'Te quiero.');
  assert.equal(fx.sent[0].parsedBody.protect_content, true);
  assert.equal(fx.completions[0].status, 'sent');
  assert.equal(JSON.stringify(result).includes('TelegramFakeBotToken'), false);

  const duplicate = await fx.delivery.confirm({
    ownerId: 'owner-uuid',
    confirmationId: preview.confirmation_id,
    body: preview.body
  });
  assert.equal(duplicate.status, 'sent');
  assert.equal(duplicate.duplicate, true);
  assert.equal(fx.sent.length, 1, 'a repeated confirmation must not send twice');

  const mismatchFx = fixture();
  const mismatchPreview = await mismatchFx.delivery.prepare({
    ownerId: 'owner-uuid', recipientId: 'contact-mom',
    body: 'Texto original.', idempotencyKey: 'voice-idem-key-000002'
  });
  const mismatch = await mismatchFx.delivery.confirm({
    ownerId: 'owner-uuid', confirmationId: mismatchPreview.confirmation_id,
    body: 'Texto alterado.'
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'telegram_confirmation_not_found');
  assert.equal(mismatchFx.sent.length, 0);

  const transportFx = fixture({
    fetchImpl: async () => { throw new Error('network unavailable'); }
  });
  const transportPreview = await transportFx.delivery.prepare({
    ownerId: 'owner-uuid', recipientId: 'contact-mom',
    body: 'No dupliques.', idempotencyKey: 'voice-idem-key-000003'
  });
  const uncertain = await transportFx.delivery.confirm({
    ownerId: 'owner-uuid', confirmationId: transportPreview.confirmation_id,
    body: transportPreview.body
  });
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.executed, false);
  assert.equal(transportFx.completions[0].status, 'unknown');
  const noRetry = await transportFx.delivery.confirm({
    ownerId: 'owner-uuid', confirmationId: transportPreview.confirmation_id,
    body: transportPreview.body
  });
  assert.equal(noRetry.status, 'blocked');
  assert.equal(noRetry.reason, 'telegram_delivery_outcome_uncertain');

  const discoveryFx = fixture({
    fetchImpl: async (url, init) => {
      assert.match(url, /getUpdates$/);
      const requestBody = JSON.parse(init.body);
      assert.deepEqual(requestBody.allowed_updates, ['message']);
      return {
        ok: true, status: 200,
        async json() {
          return {
            ok: true,
            result: [
              { update_id: 1, message: { text: '/start', chat: { id: 123456789, type: 'private' }, from: { first_name: 'Robert', username: 'robert' } } },
              { update_id: 2, message: { text: 'texto privado que no debe aparecer', chat: { id: 123456789, type: 'private' }, from: { first_name: 'Robert' } } },
              { update_id: 3, message: { text: '/start', chat: { id: -100123456789, type: 'supergroup', title: 'Familia' } } },
              { update_id: 4, message: { text: 'hola', chat: { id: 999999, type: 'private' } } }
            ]
          };
        }
      };
    }
  });
  const discoveredChats = await discoveryFx.delivery.listStartChats({
    ownerId: 'owner-uuid',
    configuredOwnerId: 'owner-uuid'
  });
  assert.equal(discoveredChats.ok, true);
  assert.equal(discoveredChats.chats.length, 2);
  assert.equal(discoveredChats.chats[0].chat_id, '123456789');
  assert.equal(JSON.stringify(discoveredChats).includes('texto privado'), false);
  const wrongOwner = await discoveryFx.delivery.listStartChats({
    ownerId: 'another-owner',
    configuredOwnerId: 'owner-uuid'
  });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.reason, 'telegram_bot_owner_mismatch');

  const verifyFx = fixture({
    fetchImpl: async (url, init) => ({
      ok: true, status: 200,
      async json() {
        return { ok: true, result: { id: 123456789, type: 'private', first_name: 'Robert', username: 'robert' } };
      }
    })
  });
  const verified = await verifyFx.delivery.verifyChat('123456789');
  assert.equal(verified.ok, true);
  assert.equal(verified.display_hint, 'Robert');
  assert.equal((await verifyFx.delivery.verifyChat('not-numeric')).reason, 'telegram_chat_id_invalid');

  console.log('ARIA VOICE V4 TELEGRAM DELIVERY CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
