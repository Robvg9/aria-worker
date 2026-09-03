'use strict';

function createHttpAdapter({ connector_id, operations, request }) {
  if (!connector_id || !Array.isArray(operations) || typeof request !== 'function') throw new TypeError('invalid adapter definition');
  async function execute({ operation, input = {}, credential_ref = null } = {}) {
    if (!operations.includes(operation)) return { status: 'blocked', reason: 'operation_unsupported' };
    if (!credential_ref || typeof credential_ref !== 'string' || !credential_ref.startsWith('secret://')) return { status: 'blocked', reason: 'credential_ref_missing' };
    try {
      const result = await request({ connector_id, operation, input, credential_ref });
      if (!result || !['succeeded','failed','blocked'].includes(result.status)) return { status: 'failed', reason: 'invalid_connector_response' };
      return result;
    } catch (_) {
      return { status: 'failed', reason: 'connector_transport_error' };
    }
  }
  return Object.freeze({ connector_id, operations: [...operations], execute });
}

module.exports = { createHttpAdapter };
