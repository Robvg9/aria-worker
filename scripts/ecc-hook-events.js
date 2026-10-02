'use strict';

const crypto = require('node:crypto');

const EVENT_TYPES = new Set([
  'PreToolUse',
  'PreCompact',
  'SessionStart',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SessionEnd',
]);

const DISABLED = Object.freeze({
  activation_state: 'DISABLED',
  execution_grants: 0,
  mutation_allowed: false,
});

function hookEventId(hook) {
  if (!hook || !hook.id) throw new Error('Hook id is required');
  return crypto.createHash('sha256')
    .update(JSON.stringify([hook.id, hook.fingerprint || null, hook.event_type || null]), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function normalizeHook(hook, provenance) {
  if (!hook || typeof hook !== 'object') throw new Error('Hook descriptor is required');
  if (!EVENT_TYPES.has(hook.event_type)) throw new Error(`Unsupported hook event type: ${hook.event_type}`);

  return {
    hook_event_id: `ecc.hook.${hookEventId(hook)}`,
    id: hook.id,
    event_type: hook.event_type,
    description: hook.description || null,
    fingerprint: hook.fingerprint || null,
    source: {
      path: provenance.path,
      sha: provenance.sha,
      commit_sha: provenance.commit_sha,
      tag: provenance.tag,
    },
    matcher: hook.matcher || '.*',
    command_reference: null,
    handler_reference: null,
    activation_state: DISABLED.activation_state,
    execution_grants: DISABLED.execution_grants,
    mutation_allowed: DISABLED.mutation_allowed,
    approval_required: true,
    verification_required: true,
  };
}

function buildHookEventCatalog(metadata, provenance) {
  if (!metadata || typeof metadata.entries !== 'object') {
    throw new Error('ECC hook metadata entries are required');
  }

  const hooks = [];
  for (const [eventType, entries] of Object.entries(metadata.entries)) {
    if (!EVENT_TYPES.has(eventType)) throw new Error(`Unsupported hook event type: ${eventType}`);
    for (const entry of entries || []) {
      hooks.push(normalizeHook({ ...entry, event_type: eventType }, provenance));
    }
  }

  hooks.sort((a, b) => a.hook_event_id.localeCompare(b.hook_event_id));

  const canonical = {
    schema: 'aria.ecc-hook-event-catalog.v1',
    deterministic: true,
    source: {
      repository: 'https://github.com/affaan-m/ECC',
      tag: provenance.tag,
      commit_sha: provenance.commit_sha,
      path: provenance.path,
      sha: provenance.sha,
    },
    policy: {
      default_enabled: false,
      approval_required: true,
      verification_required: true,
      executable_command_references: false,
      auto_activation: false,
    },
    hooks,
  };

  return {
    ...canonical,
    catalog_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      total_hooks: hooks.length,
      event_types: new Set(hooks.map(h => h.event_type)).size,
      enabled: 0,
      execution_grants: 0,
    },
  };
}

function buildHookActivationProposal(catalog, hookIds = []) {
  if (!catalog || catalog.schema !== 'aria.ecc-hook-event-catalog.v1') {
    throw new Error('Unsupported hook event catalog');
  }
  const selected = [...new Set(hookIds)];
  const byId = new Map(catalog.hooks.map(h => [h.hook_event_id, h]));
  for (const id of selected) {
    if (!byId.has(id)) throw new Error(`Unknown hook event: ${id}`);
  }

  const proposal = {
    schema: 'aria.ecc-hook-activation-proposal.v1',
    deterministic: true,
    catalog_digest_sha256: catalog.catalog_digest_sha256,
    policy: {
      approved_by_aria: false,
      activation_mutation: false,
      execution_grants: 0,
    },
    selections: selected.sort().map(id => ({
      hook_event_id: id,
      requested: true,
      approved: false,
      enabled: false,
      activation_state: 'AWAITING_ARIA_APPROVAL',
    })),
  };

  return {
    ...proposal,
    proposal_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(proposal), 'utf8').digest('hex'),
  };
}

module.exports = {
  EVENT_TYPES: [...EVENT_TYPES],
  hookEventId,
  normalizeHook,
  buildHookEventCatalog,
  buildHookActivationProposal,
};
