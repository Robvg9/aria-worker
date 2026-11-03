# ARIA Voice V4 — Telegram delivery setup

## Security and delivery contract

- The Telegram Bot API token is server-only: \`ARIA_TELEGRAM_BOT_TOKEN\`. Never put it in the PWA, APK, Git repository, browser storage, logs, or ChatGPT messages.
- \`ARIA_TELEGRAM_OWNER_ID\` must equal the Supabase Auth UUID of the one owner authorized to use this bot. The chat-discovery route returns only minimal \`/start\` chat metadata and fails closed for every other owner.
- A recipient is stored in the owner-scoped \`aria_internal.voice_message_recipients\` allowlist. A caller cannot supply an arbitrary chat ID at send time.
- Preparing a message stores only its SHA-256 digest, recipient alias, idempotency key, and expiry. The message body is shown in the authenticated PWA confirmation panel and is not persisted in the dispatch table.
- A send can occur only after a separate authenticated confirmation containing the exact original body and one-time confirmation ID.
- The database atomically grants the send claim to one request only. Concurrent/repeated confirmations cannot both call Telegram.
- Provider transport ambiguity becomes \`unknown\`; ARIA does not retry automatically. Check the Telegram chat before creating a new message.
- The UI reports success only after Telegram returns a valid \`sendMessage\` acknowledgement and ARIA persists that acknowledgement.

## Operator setup

1. In Telegram, open the official \`@BotFather\` account and send \`/newbot\`. Follow its prompts and copy the bot token once.
2. In the Supabase Dashboard for the ARIA project, open **Edge Functions → Secrets** and add:
   - \`ARIA_TELEGRAM_BOT_TOKEN\`: the token from BotFather.
   - \`ARIA_TELEGRAM_OWNER_ID\`: the authenticated Supabase user UUID shown inside ARIA's Telegram setup panel.
3. Open the new bot in Telegram and press **Start**, or send \`/start\`.
4. In ARIA PWA → Conversación Directa → **Configurar destinatarios Telegram**, select **Buscar chats que enviaron /start**.
5. Choose the discovered chat, assign a short alias such as \`mama\`, and save the recipient. The server verifies it through Telegram \`getChat\` before storing it.
6. A voice intent may use the explicit phrase \`Envía por Telegram a mama: Te quiero\`. ARIA displays the exact recipient and body. Nothing is sent until **Enviar por Telegram** is pressed.

## Current limitations

- The first implementation supports one owner-scoped bot token per deployment. Do not share the same bot across unrelated owners.
- Chat discovery uses Telegram \`getUpdates\`; it will fail if a webhook is configured for that bot. Do not configure both polling and a webhook at the same time.
- Telegram delivery does not imply end-to-end encryption. Telegram Bot API messages are bot messages, not Secret Chats.
- This feature remains disabled until the migration is reviewed/applied, the Edge Function is deployed, both secrets are set, and a recipient is registered.
- Voice-triggered use still depends on the independent native signing bridge and speaker-verification gates. This setup does not bypass those controls.
