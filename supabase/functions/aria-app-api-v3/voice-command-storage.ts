/**
 * Service-role-only persistence adapters for Voice V4:
 * - single-use owner session nonces
 * - shared cross-device command idempotency
 * - trusted per-device Ed25519 public keys
 * - owner/device speaker threshold policy
 *
 * The caller must pass the user ID from a validated Supabase Auth session.
 * This adapter never creates mission/job records and stores no audio,
 * transcript, message body, private key, speaker embedding, or voice template.
 */

function requireUuid(value: string, label: string): void {
  if (typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(label + " must be an authenticated UUID");
  }
}

function requireDeviceId(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(value)) {
    throw new TypeError("valid device id required");
  }
}

export function createVoiceCommandStores(serviceClient: any, authenticatedOwnerId: string) {
  if (!serviceClient || typeof serviceClient.schema !== "function") {
    throw new TypeError("service Supabase client required");
  }
  requireUuid(authenticatedOwnerId, "authenticated owner id");

  const internal = serviceClient.schema("aria_internal");

  const nonceStore = Object.freeze({
    async consume(input: {
      nonce: string;
      deviceId: string;
      ownerId: string;
      sessionId: string;
      requestId: string;
      expiresAt: number;
    }): Promise<boolean> {
      if (input.ownerId !== authenticatedOwnerId) {
        throw new Error("owner_session_owner_mismatch");
      }
      requireDeviceId(input.deviceId);
      if (!Number.isSafeInteger(input.expiresAt)) throw new Error("owner_session_expiry_invalid");
      const { data, error } = await internal.rpc("consume_voice_owner_session_nonce", {
        p_owner_user_id: authenticatedOwnerId,
        p_device_id: input.deviceId,
        p_session_id: input.sessionId,
        p_request_id: input.requestId,
        p_nonce: input.nonce,
        p_expires_at: new Date(input.expiresAt).toISOString()
      });
      if (error) throw new Error("voice_owner_session_nonce_store_unavailable");
      return data === true;
    }
  });

  const idempotencyStore = Object.freeze({
    async claim(input: {
      ownerId: string;
      key: string;
      requestId: string;
      deviceId: string | null;
      operation: string;
      expiresAt: number;
    }): Promise<boolean> {
      if (input.ownerId !== authenticatedOwnerId) {
        throw new Error("voice_command_idempotency_owner_mismatch");
      }
      if (input.deviceId !== null) requireDeviceId(input.deviceId);
      if (!Number.isSafeInteger(input.expiresAt)) throw new Error("voice_command_expiry_invalid");
      const { data, error } = await internal.rpc("claim_voice_command_idempotency", {
        p_owner_user_id: authenticatedOwnerId,
        p_idempotency_key: input.key,
        p_request_id: input.requestId,
        p_device_id: input.deviceId,
        p_operation: input.operation,
        p_expires_at: new Date(input.expiresAt).toISOString()
      });
      if (error) throw new Error("voice_command_idempotency_store_unavailable");
      return data === true;
    }
  });

  async function registerTrustedDeviceKey(input: {
    ownerId: string;
    deviceId: string;
    deviceToken: string;
    publicKeyId: string;
    publicKeyEd25519: string;
  }): Promise<any> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_device_owner_mismatch");
    requireDeviceId(input.deviceId);
    if (typeof input.deviceToken !== "string" || input.deviceToken.length < 32) {
      throw new Error("voice_device_token_invalid");
    }
    if (typeof input.publicKeyId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.publicKeyId)) {
      throw new Error("voice_device_public_key_id_invalid");
    }
    if (typeof input.publicKeyEd25519 !== "string"
        || !/^[A-Za-z0-9_-]{43}$/.test(input.publicKeyEd25519)) {
      throw new Error("voice_device_public_key_invalid");
    }
    const { data, error } = await internal.rpc("register_voice_trusted_device_key", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_device_token: input.deviceToken,
      p_public_key_id: input.publicKeyId,
      p_public_key_ed25519: input.publicKeyEd25519
    });
    if (error) throw new Error("voice_device_key_registration_failed");
    return data || null;
  }

  async function pairOwnerDeviceKey(input: {
    ownerId: string;
    deviceId: string;
    deviceToken: string;
    publicKeyId: string;
    publicKeyEd25519: string;
  }): Promise<any> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_device_owner_mismatch");
    if (typeof input.deviceId !== "string" || !/^android-voice-[a-f0-9]{64}$/.test(input.deviceId)) {
      throw new Error("voice_android_device_id_invalid");
    }
    if (typeof input.deviceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.deviceToken)) {
      throw new Error("voice_android_pairing_token_invalid");
    }
    if (input.publicKeyId !== "aria-android-keystore-ed25519-v1") {
      throw new Error("voice_android_public_key_id_invalid");
    }
    if (typeof input.publicKeyEd25519 !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.publicKeyEd25519)) {
      throw new Error("voice_android_public_key_invalid");
    }
    const { data, error } = await internal.rpc("pair_voice_owner_device", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_device_token: input.deviceToken,
      p_public_key_id: input.publicKeyId,
      p_public_key_ed25519: input.publicKeyEd25519
    });
    if (error || !data || data.owner_id !== authenticatedOwnerId
        || data.device_id !== input.deviceId || data.enabled !== true
        || data.security !== "trusted" || data.wake_word_enabled !== false
        || JSON.stringify(data.capabilities) !== "[]") {
      throw new Error("voice_android_owner_pairing_rejected");
    }
    return data;
  }

  async function heartbeatOwnerDeviceKey(input: {
    ownerId: string;
    deviceId: string;
    deviceToken: string;
  }): Promise<boolean> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_device_owner_mismatch");
    if (typeof input.deviceId !== "string" || !/^android-voice-[a-f0-9]{64}$/.test(input.deviceId)) {
      throw new Error("voice_android_device_id_invalid");
    }
    if (typeof input.deviceToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.deviceToken)) {
      throw new Error("voice_android_pairing_token_invalid");
    }
    const { data, error } = await internal.rpc("touch_voice_owner_device", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_device_token: input.deviceToken
    });
    if (error) throw new Error("voice_android_owner_heartbeat_failed");
    return data === true;
  }

  async function resolveTrustedDeviceKey(deviceId: string): Promise<any | null> {
    requireDeviceId(deviceId);
    const { data, error } = await internal.rpc("resolve_voice_trusted_device_key", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: deviceId
    });
    if (error) throw new Error("trusted_voice_device_lookup_failed");
    if (!data || data.owner_id !== authenticatedOwnerId
        || data.device_id !== deviceId
        || data.security !== "trusted"
        || data.enabled !== true
        || data.health !== "healthy"
        || typeof data.public_key !== "string") return null;
    return {
      owner_id: data.owner_id,
      owner_id_verified: true,
      ownerId: data.owner_id,
      device_id: data.device_id,
      public_key_id: data.public_key_id,
      public_key: data.public_key,
      security: data.security,
      enabled: data.enabled,
      health: data.health,
      last_seen_at: data.last_seen_at
    };
  }

  async function revokeTrustedDeviceKey(input: { ownerId: string; deviceId: string }): Promise<boolean> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_device_owner_mismatch");
    requireDeviceId(input.deviceId);
    const { data, error } = await internal.rpc("revoke_voice_trusted_device_key", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId
    });
    if (error) throw new Error("voice_device_key_revocation_failed");
    return data === true;
  }

  async function setSpeakerPolicy(input: {
    ownerId: string;
    deviceId: string;
    modelId: string;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_speaker_owner_mismatch");
    requireDeviceId(input.deviceId);
    if (typeof input.modelId !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(input.modelId)) {
      throw new Error("voice_speaker_model_id_invalid");
    }
    const { data: model, error: modelError } = await internal.from("voice_speaker_model_catalog")
      .select("minimum_score_floor,status,approved_at,evaluation_evidence_ref")
      .eq("model_id", input.modelId)
      .eq("status", "approved")
      .not("approved_at", "is", null)
      .not("evaluation_evidence_ref", "is", null)
      .contains("supported_languages", ["es-CU"])
      .maybeSingle();
    if (modelError || !model) throw new Error("voice_speaker_model_not_approved");
    const minimumScore = Number(model.minimum_score_floor);
    if (!Number.isFinite(minimumScore) || minimumScore <= 0 || minimumScore > 1) {
      throw new Error("voice_speaker_threshold_floor_invalid");
    }
    const { data, error } = await internal.rpc("set_voice_speaker_policy", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_speaker_model_id: input.modelId,
      p_minimum_score: minimumScore,
      p_enabled: true
    });
    if (error) throw new Error("voice_speaker_policy_update_failed");
    return data || null;
  }

  async function resolveSpeakerPolicy(input: { ownerId: string; deviceId: string }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_speaker_owner_mismatch");
    requireDeviceId(input.deviceId);
    const { data, error } = await internal.rpc("resolve_voice_speaker_policy", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId
    });
    if (error) throw new Error("voice_speaker_policy_lookup_failed");
    if (!data || data.enabled !== true
        || typeof data.modelId !== "string"
        || typeof data.minimumScore !== "number"
        || !Number.isFinite(data.minimumScore)
        || data.minimumScore < 0 || data.minimumScore > 1) return null;
    return {
      enabled: true,
      modelId: data.modelId,
      minimumScore: data.minimumScore
    };
  }

  async function revokeSpeakerPolicy(input: { ownerId: string; deviceId: string }): Promise<boolean> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_speaker_owner_mismatch");
    requireDeviceId(input.deviceId);
    const { data, error } = await internal.rpc("revoke_voice_speaker_policy", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId
    });
    if (error) throw new Error("voice_speaker_policy_revocation_failed");
    return data === true;
  }

  async function getDeviceCommandStatus(input: {
    ownerId: string;
    commandId: string;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_command_status_owner_mismatch");
    if (typeof input.commandId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
      throw new Error("voice_command_status_id_invalid");
    }

    const { data, error } = await internal.from("voice_device_commands")
      .select("command_id,device_id,operation,status,requested_at,expires_at,claimed_at,started_at,completed_at,result,error_code")
      .eq("owner_user_id", authenticatedOwnerId)
      .eq("command_id", input.commandId)
      .maybeSingle();
    if (error) throw new Error("voice_command_status_lookup_failed");
    if (!data) return null;

    const rawResult = data.result && typeof data.result === "object" && !Array.isArray(data.result)
      ? data.result : {};
    const allowedResultFields = new Set(["ok","brightness","app_id","opened","verified"]);
    const safeResult: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawResult)) {
      if (!allowedResultFields.has(key)) continue;
      if (typeof value === "string" && value.length <= 160) safeResult[key] = value;
      else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) safeResult[key] = value;
    }
    return { ...data, result: safeResult };
  }

  async function enqueueDeviceCommand(input: {
    ownerId: string;
    deviceId: string;
    sourceDeviceId: string;
    requestId: string;
    idempotencyKey: string;
    operation: string;
    params: Record<string, unknown>;
    expiresAt: number;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_command_owner_mismatch");
    requireDeviceId(input.deviceId);
    requireDeviceId(input.sourceDeviceId);
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.requestId)) {
      throw new Error("voice_command_request_id_invalid");
    }
    if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
      throw new Error("voice_command_idempotency_key_invalid");
    }
    if (!Number.isSafeInteger(input.expiresAt)) throw new Error("voice_command_expiry_invalid");

    const params = input.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new Error("voice_command_params_invalid");
    }
    if (input.operation === "display.brightness.set") {
      const keys = Object.keys(params);
      if (keys.length !== 1 || keys[0] !== "brightness"
          || typeof params.brightness !== "number" || !Number.isInteger(params.brightness)
          || params.brightness < 0 || params.brightness > 100) {
        throw new Error("voice_brightness_params_invalid");
      }
    } else if (input.operation === "app.open") {
      const keys = Object.keys(params);
      if (keys.length !== 1 || keys[0] !== "app_id"
          || typeof params.app_id !== "string" || !/^[A-Za-z0-9._-]{1,120}$/.test(params.app_id)) {
        throw new Error("voice_app_open_params_invalid");
      }
    } else if (input.operation === "browser.open_url") {
      const keys = Object.keys(params);
      if (keys.length !== 1 || keys[0] !== "url"
          || typeof params.url !== "string" || params.url.length > 2048) {
        throw new Error("voice_browser_url_params_invalid");
      }
      let parsed: URL;
      try { parsed = new URL(params.url); } catch { throw new Error("voice_browser_url_params_invalid"); }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password
          || parsed.hostname.length < 3) throw new Error("voice_browser_url_params_invalid");
      // API router checks the allowed host before this persistence method.
    } else {
      throw new Error("voice_device_operation_not_allowlisted");
    }

    const { data, error } = await internal.rpc("enqueue_voice_device_command", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_source_device_id: input.sourceDeviceId,
      p_request_id: input.requestId,
      p_idempotency_key: input.idempotencyKey,
      p_operation: input.operation,
      p_params: params,
      p_expires_at: new Date(input.expiresAt).toISOString()
    });
    if (error) throw new Error("voice_device_command_enqueue_failed");
    return data || null;
  }


  async function getTelegramRecipient(recipientId: string): Promise<any | null> {
    if (typeof recipientId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(recipientId)) {
      throw new Error("telegram_recipient_id_invalid");
    }
    const { data, error } = await internal.from("voice_message_recipients")
      .select("recipient_id,display_name,telegram_chat_id,enabled,channel")
      .eq("owner_user_id", authenticatedOwnerId)
      .eq("recipient_id", recipientId)
      .maybeSingle();
    if (error) throw new Error("telegram_recipient_lookup_failed");
    return data || null;
  }

  async function listTelegramRecipients(): Promise<any[]> {
    const { data, error } = await internal.from("voice_message_recipients")
      .select("recipient_id,display_name,enabled,channel,created_at,updated_at")
      .eq("owner_user_id", authenticatedOwnerId)
      .order("display_name", { ascending: true })
      .limit(100);
    if (error) throw new Error("telegram_recipient_list_failed");
    return Array.isArray(data) ? data : [];
  }

  async function upsertTelegramRecipient(input: {
    recipientId: string;
    displayName: string;
    telegramChatId: string;
  }): Promise<any> {
    if (typeof input.recipientId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.recipientId)
        || typeof input.displayName !== "string" || input.displayName.trim().length < 1
        || input.displayName.trim().length > 120
        || typeof input.telegramChatId !== "string" || !/^-?[0-9]{1,20}$/.test(input.telegramChatId)) {
      throw new Error("telegram_recipient_input_invalid");
    }
    const { data, error } = await internal.from("voice_message_recipients").upsert({
      owner_user_id: authenticatedOwnerId,
      recipient_id: input.recipientId,
      display_name: input.displayName.trim(),
      telegram_chat_id: input.telegramChatId,
      channel: "telegram",
      enabled: true,
      updated_at: new Date().toISOString()
    }, { onConflict: "owner_user_id,recipient_id" })
      .select("recipient_id,display_name,enabled,channel,created_at,updated_at")
      .single();
    if (error || !data) throw new Error("telegram_recipient_save_failed");
    return data;
  }

  async function prepareTelegramDispatch(input: {
    ownerId: string;
    confirmationId: string;
    idempotencyKey: string;
    recipientId: string;
    bodyHash: string;
    expiresAt: number;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("telegram_message_owner_mismatch");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.confirmationId)
        || !/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(input.recipientId)
        || !/^[a-f0-9]{64}$/.test(input.bodyHash)
        || !Number.isSafeInteger(input.expiresAt)) {
      throw new Error("telegram_message_prepare_input_invalid");
    }
    const { data, error } = await internal.rpc("prepare_voice_telegram_message", {
      p_owner_user_id: authenticatedOwnerId,
      p_confirmation_id: input.confirmationId,
      p_idempotency_key: input.idempotencyKey,
      p_recipient_id: input.recipientId,
      p_body_sha256: input.bodyHash,
      p_expires_at: new Date(input.expiresAt).toISOString()
    });
    if (error) throw new Error("telegram_message_prepare_failed");
    return data || null;
  }

  async function claimTelegramDispatch(input: {
    ownerId: string;
    confirmationId: string;
    bodyHash: string;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("telegram_message_owner_mismatch");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.confirmationId)
        || !/^[a-f0-9]{64}$/.test(input.bodyHash)) {
      throw new Error("telegram_message_claim_input_invalid");
    }
    const { data, error } = await internal.rpc("claim_voice_telegram_message", {
      p_owner_user_id: authenticatedOwnerId,
      p_confirmation_id: input.confirmationId,
      p_body_sha256: input.bodyHash
    });
    if (error) throw new Error("telegram_message_claim_failed");
    return data || null;
  }

  async function completeTelegramDispatch(input: {
    ownerId: string;
    confirmationId: string;
    status: "sent" | "failed" | "unknown";
    providerMessageId?: number | null;
    providerChatId?: string | null;
    errorCode?: string | null;
  }): Promise<boolean> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("telegram_message_owner_mismatch");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.confirmationId)
        || !["sent", "failed", "unknown"].includes(input.status)) {
      throw new Error("telegram_message_completion_input_invalid");
    }
    const { data, error } = await internal.rpc("complete_voice_telegram_message", {
      p_owner_user_id: authenticatedOwnerId,
      p_confirmation_id: input.confirmationId,
      p_status: input.status,
      p_provider_message_id: input.providerMessageId ?? null,
      p_provider_chat_id: input.providerChatId ?? null,
      p_error_code: input.errorCode ?? null
    });
    if (error) throw new Error("telegram_message_completion_failed");
    return data === true;
  }

  return Object.freeze({
    nonceStore,
    idempotencyStore,
    enqueueDeviceCommand,
    getDeviceCommandStatus,
    registerTrustedDeviceKey,
    pairOwnerDeviceKey,
    heartbeatOwnerDeviceKey,
    resolveTrustedDeviceKey,
    revokeTrustedDeviceKey,
    setSpeakerPolicy,
    resolveSpeakerPolicy,
    revokeSpeakerPolicy,
    getTelegramRecipient,
    listTelegramRecipients,
    upsertTelegramRecipient,
    prepareTelegramDispatch,
    claimTelegramDispatch,
    completeTelegramDispatch
  });
}


/**
 * Device-side queue adapter. It can be constructed only inside a service-role
 * API/worker after route-level rate limiting; SQL independently validates
 * the per-device token on every claim and completion.
 */
export function createVoiceDeviceAgentQueue(serviceClient: any) {
  if (!serviceClient || typeof serviceClient.schema !== "function") {
    throw new TypeError("service Supabase client required");
  }
  const internal = serviceClient.schema("aria_internal");

  async function claim(input: { deviceId: string; deviceToken: string }): Promise<any | null> {
    requireDeviceId(input.deviceId);
    if (typeof input.deviceToken !== "string" || input.deviceToken.length < 32) {
      throw new Error("voice_agent_device_token_invalid");
    }
    const { data, error } = await internal.rpc("claim_voice_device_command", {
      p_device_id: input.deviceId,
      p_device_token: input.deviceToken
    });
    if (error) throw new Error("voice_device_command_claim_failed");
    return data || null;
  }

  async function complete(input: {
    commandId: string;
    deviceId: string;
    deviceToken: string;
    status: "succeeded" | "failed";
    result?: Record<string, unknown>;
    errorCode?: string | null;
  }): Promise<boolean> {
    requireDeviceId(input.deviceId);
    if (typeof input.deviceToken !== "string" || input.deviceToken.length < 32) {
      throw new Error("voice_agent_device_token_invalid");
    }
    if (typeof input.commandId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
      throw new Error("voice_command_id_invalid");
    }
    if (input.status !== "succeeded" && input.status !== "failed") {
      throw new Error("voice_command_status_invalid");
    }
    const result = input.result || {};
    const allowed = new Set(["ok","brightness","app_id","opened","verified"]);
    for (const [key, value] of Object.entries(result)) {
      if (!allowed.has(key)) throw new Error("voice_command_result_field_unsupported");
      if (typeof value === "string" && value.length > 160) throw new Error("voice_command_result_value_invalid");
      if (!["string","number","boolean"].includes(typeof value)) throw new Error("voice_command_result_value_invalid");
    }
    const { data, error } = await internal.rpc("complete_voice_device_command", {
      p_command_id: input.commandId,
      p_device_id: input.deviceId,
      p_device_token: input.deviceToken,
      p_status: input.status,
      p_result: result,
      p_error_code: input.errorCode || null
    });
    if (error) throw new Error("voice_device_command_completion_failed");
    return data === true;
  }

  return Object.freeze({ claim, complete });
}
