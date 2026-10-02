'use strict';

const crypto = require('node:crypto');

function digestSession(session) {
  const canonical = { ...session };
  delete canonical.session_digest_sha256;
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function createSessionContract(input = {}) {
  if (!input.session_id) throw new Error('session_id is required');
  if (!input.project_id) throw new Error('project_id is required');

  const session = {
    schema: 'aria.ecc-session-contract.v1',
    session_id: String(input.session_id),
    project_id: String(input.project_id),
    mission_id: input.mission_id ? String(input.mission_id) : null,
    state: 'ACTIVE',
    revision: 0,
    continuation_key: input.continuation_key ? String(input.continuation_key) : String(input.session_id),
    checkpoint: input.checkpoint || null,
    owner_scope: input.owner_scope ? String(input.owner_scope) : 'ARIA_SESSION',
    execution_authority: 'ARIA_CONTROLLED',
  };

  return { ...session, session_digest_sha256: digestSession(session) };
}

function advanceSession(session, expectedRevision, patch = {}) {
  if (!session || session.schema !== 'aria.ecc-session-contract.v1') {
    throw new Error('Unsupported session contract');
  }
  if (session.revision !== expectedRevision) {
    throw new Error(`SESSION_REVISION_CONFLICT: expected ${expectedRevision}, actual ${session.revision}`);
  }
  if (patch.state && !['ACTIVE', 'PAUSED', 'CLOSED'].includes(patch.state)) {
    throw new Error(`Unsupported session state: ${patch.state}`);
  }

  const next = {
    ...session,
    ...patch,
    revision: session.revision + 1,
  };
  delete next.session_digest_sha256;

  return { ...next, session_digest_sha256: digestSession(next) };
}

module.exports = { createSessionContract, advanceSession, digestSession };
