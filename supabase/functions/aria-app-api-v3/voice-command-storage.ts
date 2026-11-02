/**
 * Service-role-only persistence adapters for the Voice V4 signed-session
 * nonce and direct-command idempotency contracts.
 *
 * The caller must pass the owner ID from the validated Supabase Auth session.
 * This module never creates mission/job records and stores no audio,
 * transcript, message body, or speaker template.
 */
export function createVoiceCommandStores(serviceClient: any, authenticatedOwnerId: string) {
  if (!serviceClient || typeof serviceClient.schema !== "function") {
    throw new TypeError("service Supabase client required");
  }
  if (typeof authenticatedOwnerId !== "string"
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(authenticatedOwnerId)) {
    throw new TypeError("authenticated owner id required");
  }

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

  return Object.freeze({ nonceStore, idempotencyStore });
}
