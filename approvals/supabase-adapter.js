'use strict';

function assertClient(client) {
  if (!client || typeof client.schema !== 'function') {
    throw new TypeError('supabase client must be injected');
  }
}

function createSupabaseApprovalAdapter(client) {
  assertClient(client);

  function table() {
    const schema = client.schema('aria_internal');
    if (!schema || typeof schema.from !== 'function') throw new TypeError('invalid supabase schema client');
    return schema.from('execution_approvals');
  }

  function sameTarget(left, right) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return {
    async create(record) {
      const { data, error } = await table().insert(record).select().single();
      if (error) throw new Error('approval_store_create_failed');
      return data;
    },

    async get(authorizationId) {
      if (!authorizationId) return null;
      const { data, error } = await table().select('*').eq('authorization_id', authorizationId).maybeSingle();
      if (error) throw new Error('approval_store_read_failed');
      return data ?? null;
    },

    async canExecute(authorizationId, binding, now = new Date()) {
      if (!authorizationId || !binding || typeof binding !== 'object') return false;

      const record = await this.get(authorizationId);
      if (!record || record.status !== 'approved') return false;
      if (record.authorization_id !== authorizationId) return false;

      const required = ['request_id', 'execution_id', 'tool_id', 'operation', 'risk_class', 'policy_version'];
      for (const key of required) {
        if (typeof binding[key] !== 'string' || binding[key].trim().length === 0) return false;
        if (record[key] !== binding[key]) return false;
      }

      if (!binding.target || typeof binding.target !== 'object' || Array.isArray(binding.target)) return false;
      if (!sameTarget(record.target, binding.target)) return false;

      const expiresAt = Date.parse(record.expires_at);
      const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
      if (!Number.isFinite(expiresAt) || !Number.isFinite(nowMs)) return false;
      if (expiresAt <= nowMs) return false;

      return true;
    },

    async transition(authorizationId, expectedStatus, nextStatus, decision) {
      if (!authorizationId) throw new Error('authorization_id_missing');
      const patch = { status: nextStatus, updated_at: decision.updated_at ?? new Date().toISOString() };
      if (nextStatus === 'approved') {
        patch.approved_by = decision.approved_by ?? null;
        patch.approved_at = decision.approved_at ?? null;
        patch.verification_ref = decision.verification_ref ?? null;
      }
      const { data, error } = await table()
        .update(patch)
        .eq('authorization_id', authorizationId)
        .eq('status', expectedStatus)
        .select()
        .single();
      if (error) throw new Error('approval_store_transition_failed');
      return data;
    }
  };
}

module.exports = { createSupabaseApprovalAdapter };
