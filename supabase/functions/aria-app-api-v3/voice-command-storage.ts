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
    minimumScore: number;
    enabled: boolean;
  }): Promise<any | null> {
    if (input.ownerId !== authenticatedOwnerId) throw new Error("voice_speaker_owner_mismatch");
    requireDeviceId(input.deviceId);
    if (typeof input.modelId !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(input.modelId)) {
      throw new Error("voice_speaker_model_id_invalid");
    }
    if (typeof input.minimumScore !== "number" || !Number.isFinite(input.minimumScore)
        || input.minimumScore < 0 || input.minimumScore > 1) {
      throw new Error("voice_speaker_threshold_invalid");
    }
    if (typeof input.enabled !== "boolean") throw new Error("voice_speaker_enabled_invalid");
    const { data, error } = await internal.rpc("set_voice_speaker_policy", {
      p_owner_user_id: authenticatedOwnerId,
      p_device_id: input.deviceId,
      p_speaker_model_id: input.modelId,
      p_minimum_score: input.minimumScore,
      p_enabled: input.enabled
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

  return Object.freeze({
    nonceStore,
    idempotencyStore,
    registerTrustedDeviceKey,
    resolveTrustedDeviceKey,
    revokeTrustedDeviceKey,
    setSpeakerPolicy,
    resolveSpeakerPolicy,
    revokeSpeakerPolicy
  });
}
