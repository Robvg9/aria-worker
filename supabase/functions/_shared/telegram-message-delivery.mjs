'use strict';

const TELEGRAM_API = 'https://api.telegram.org';
const RECIPIENT_ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/i;
const CONFIRMATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,128}$/;
const CHAT_ID_RE = /^-?[0-9]{1,20}$/;

function safeObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateBody(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function createTelegramMessageDelivery({
  botToken,
  stores,
  fetchImpl = fetch,
  now = Date.now,
  randomUUID = () => crypto.randomUUID()
} = {}) {
  const token = typeof botToken === 'string' ? botToken.trim() : '';
  if (!stores || typeof stores.getTelegramRecipient !== 'function'
      || typeof stores.prepareTelegramDispatch !== 'function'
      || typeof stores.claimTelegramDispatch !== 'function'
      || typeof stores.completeTelegramDispatch !== 'function') {
    throw new TypeError('telegram_message_stores_required');
  }
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof randomUUID !== 'function') {
    throw new TypeError('telegram_message_runtime_invalid');
  }

  async function verifyChat(chatId) {
    if (!token) return { ok: false, reason: 'telegram_provider_not_configured' };
    if (typeof chatId !== 'string' || !CHAT_ID_RE.test(chatId)) {
      return { ok: false, reason: 'telegram_chat_id_invalid' };
    }
    let response;
    try {
      response = await fetchImpl(TELEGRAM_API + '/bot' + token + '/getChat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId })
      });
    } catch {
      return { ok: false, reason: 'telegram_verification_unavailable' };
    }
    let payload;
    try { payload = await response.json(); } catch { return { ok: false, reason: 'telegram_verification_unavailable' }; }
    if (!response.ok || payload?.ok !== true || !safeObject(payload.result)
        || String(payload.result.id) !== chatId) {
      return { ok: false, reason: 'telegram_chat_not_reachable' };
    }
    const result = payload.result;
    const first = typeof result.first_name === 'string' ? result.first_name.trim() : '';
    const last = typeof result.last_name === 'string' ? result.last_name.trim() : '';
    const title = typeof result.title === 'string' ? result.title.trim() : '';
    const username = typeof result.username === 'string' ? '@' + result.username : '';
    return {
      ok: true,
      chat_id: chatId,
      chat_type: String(result.type || ''),
      display_hint: (title || [first, last].filter(Boolean).join(' ') || username || 'Telegram chat').slice(0, 120)
    };
  }

  async function prepare({ ownerId, recipientId, body, idempotencyKey }) {
    if (!token) return { ok: false, reason: 'telegram_provider_not_configured' };
    if (typeof ownerId !== 'string' || !ownerId) return { ok: false, reason: 'message_owner_invalid' };
    if (typeof recipientId !== 'string' || !RECIPIENT_ID_RE.test(recipientId)) {
      return { ok: false, reason: 'message_recipient_invalid' };
    }
    if (!validateBody(body)) return { ok: false, reason: 'message_body_invalid' };
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_RE.test(idempotencyKey)) {
      return { ok: false, reason: 'message_idempotency_invalid' };
    }

    let recipient;
    try { recipient = await stores.getTelegramRecipient(recipientId); }
    catch { return { ok: false, reason: 'telegram_recipient_lookup_failed' }; }
    if (!recipient || recipient.enabled !== true || typeof recipient.telegram_chat_id !== 'string'
        || !CHAT_ID_RE.test(recipient.telegram_chat_id)) {
      return { ok: false, reason: 'telegram_recipient_not_configured' };
    }

    const confirmationId = randomUUID();
    if (!CONFIRMATION_ID_RE.test(confirmationId)) return { ok: false, reason: 'message_confirmation_id_invalid' };
    const bodyHash = await sha256Hex(body.trim());
    const expiresAt = Number(now()) + 120000;
    let prepared;
    try {
      prepared = await stores.prepareTelegramDispatch({
        ownerId,
        confirmationId,
        idempotencyKey,
        recipientId,
        bodyHash,
        expiresAt
      });
    } catch {
      return { ok: false, reason: 'telegram_message_prepare_failed' };
    }
    if (!safeObject(prepared) || typeof prepared.confirmation_id !== 'string'
        || !CONFIRMATION_ID_RE.test(prepared.confirmation_id)) {
      return { ok: false, reason: 'telegram_message_prepare_failed' };
    }
    if (prepared.status !== 'prepared') {
      return {
        ok: false,
        reason: prepared.status === 'sent' ? 'telegram_message_already_sent' : 'telegram_message_already_in_progress'
      };
    }
    return {
      ok: true,
      confirmation_id: prepared.confirmation_id,
      recipient_id: recipientId,
      recipient_name: String(recipient.display_name || recipientId).slice(0, 120),
      body: body.trim(),
      expires_at: prepared.expires_at || new Date(expiresAt).toISOString(),
      confirmation_channel: 'visible_authenticated_ui'
    };
  }

  async function confirm({ ownerId, confirmationId, body }) {
    if (!token) return { ok: false, status: 'blocked', reason: 'telegram_provider_not_configured', executed: false };
    if (typeof ownerId !== 'string' || !ownerId
        || typeof confirmationId !== 'string' || !CONFIRMATION_ID_RE.test(confirmationId)
        || !validateBody(body)) {
      return { ok: false, status: 'blocked', reason: 'telegram_confirmation_invalid', executed: false };
    }
    const bodyHash = await sha256Hex(body.trim());
    let claimed;
    try {
      claimed = await stores.claimTelegramDispatch({ ownerId, confirmationId, bodyHash });
    } catch {
      return { ok: false, status: 'failed', reason: 'telegram_dispatch_claim_unavailable', executed: false };
    }
    if (!safeObject(claimed) || typeof claimed.status !== 'string') {
      return { ok: false, status: 'blocked', reason: 'telegram_confirmation_not_found', executed: false };
    }
    if (claimed.status === 'sent') {
      return {
        ok: true, status: 'sent', executed: true, duplicate: true,
        provider_message_id: claimed.provider_message_id ?? null
      };
    }
    if (claimed.status !== 'dispatching' || !CHAT_ID_RE.test(String(claimed.telegram_chat_id || ''))) {
      return {
        ok: false, status: 'blocked', executed: false,
        reason: claimed.status === 'expired' ? 'telegram_confirmation_expired'
          : claimed.status === 'unknown' || claimed.status === 'dispatching'
            ? 'telegram_delivery_outcome_uncertain' : 'telegram_confirmation_not_sendable'
      };
    }

    let response;
    let payload;
    try {
      response = await fetchImpl(TELEGRAM_API + '/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: claimed.telegram_chat_id,
          text: body.trim(),
          protect_content: true
        })
      });
      payload = await response.json();
    } catch {
      try {
        await stores.completeTelegramDispatch({
          ownerId, confirmationId, status: 'unknown', errorCode: 'telegram_transport_outcome_unknown'
        });
      } catch { /* preserve no-retry semantics even if status persistence is unavailable */ }
      return { ok: false, status: 'unknown', executed: false, reason: 'telegram_delivery_outcome_uncertain' };
    }

    if (!response.ok || payload?.ok !== true || !safeObject(payload.result)
        || !Number.isSafeInteger(payload.result.message_id)
        || String(payload.result.chat?.id) !== String(claimed.telegram_chat_id)) {
      try {
        await stores.completeTelegramDispatch({
          ownerId, confirmationId, status: response.status >= 500 ? 'unknown' : 'failed',
          errorCode: 'telegram_api_rejected'
        });
      } catch { /* no automatic retry */ }
      return {
        ok: false,
        status: response.status >= 500 ? 'unknown' : 'failed',
        executed: false,
        reason: response.status >= 500 ? 'telegram_delivery_outcome_uncertain' : 'telegram_provider_rejected'
      };
    }

    try {
      const saved = await stores.completeTelegramDispatch({
        ownerId,
        confirmationId,
        status: 'sent',
        providerMessageId: payload.result.message_id,
        providerChatId: String(payload.result.chat.id)
      });
      if (saved !== true) throw new Error('telegram_ack_persistence_failed');
    } catch {
      return {
        ok: false, status: 'unknown', executed: false,
        reason: 'telegram_delivery_ack_not_persisted',
        provider_message_id: payload.result.message_id
      };
    }
    return {
      ok: true, status: 'sent', executed: true, duplicate: false,
      provider_message_id: payload.result.message_id,
      recipient_id: claimed.recipient_id
    };
  }

  return Object.freeze({ verifyChat, prepare, confirm });
}

export { createTelegramMessageDelivery, sha256Hex, RECIPIENT_ID_RE, CONFIRMATION_ID_RE, CHAT_ID_RE };