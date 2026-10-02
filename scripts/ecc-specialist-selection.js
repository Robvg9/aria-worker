'use strict';

const crypto = require('node:crypto');

function selectSpecialists(context, agentLayer, options = {}) {
  if (!context || context.schema !== 'aria.ecc-context.v1') {
    throw new Error('Unsupported context schema');
  }
  if (context.state !== 'RESOLVED') {
    throw new Error('Specialist Selection requires resolved context');
  }
  if (!agentLayer || agentLayer.schema !== 'aria.ecc-agent-adapter-layer.v1') {
    throw new Error('Unsupported agent adapter layer');
  }

  const maxCandidates = Number.isInteger(options.max_candidates) && options.max_candidates > 0
    ? Math.min(options.max_candidates, 20)
    : 5;

  const preferred = new Set(context.constraints.preferred_surfaces || []);
  const forbidden = new Set(context.constraints.forbidden_surfaces || []);

  const candidates = (agentLayer.agents || [])
    .filter(agent => agent.lifecycle.activation_state === 'DISABLED')
    .map(agent => {
      const surfaces = new Set(agent.target_surfaces || []);
      const preferredMatches = [...preferred].filter(x => surfaces.has(x)).sort();
      const forbiddenMatches = [...forbidden].filter(x => surfaces.has(x)).sort();
      const exactSurfaceMatches = preferredMatches.length;
      const eligible = forbiddenMatches.length === 0;

      const reasons = [];
      if (exactSurfaceMatches) reasons.push(`preferred-surface:${preferredMatches.join(',')}`);
      if (!forbiddenMatches.length) reasons.push('no-forbidden-surface-match');
      if (agent.invocation.requires_context) reasons.push('context-required');
      if (agent.invocation.requires_selection) reasons.push('selection-required');
      if (agent.invocation.requires_verification) reasons.push('verification-required');

      return {
        capability_id: agent.capability_id,
        name: agent.name,
        eligible,
        match: {
          preferred_surface_matches: preferredMatches,
          forbidden_surface_matches: forbiddenMatches,
          exact_surface_matches: exactSurfaceMatches,
        },
        reasons,
        proposal_state: eligible ? 'PROPOSED' : 'REJECTED_BY_CONTEXT',
        execution_state: 'DISABLED',
      };
    })
    .filter(c => c.eligible)
    .sort((a, b) => {
      if (b.match.exact_surface_matches !== a.match.exact_surface_matches) {
        return b.match.exact_surface_matches - a.match.exact_surface_matches;
      }
      return a.capability_id.localeCompare(b.capability_id);
    })
    .slice(0, maxCandidates);

  const canonical = {
    schema: 'aria.ecc-specialist-selection.v1',
    deterministic: true,
    context_digest_sha256: context.context_digest_sha256,
    source: {
      repository: agentLayer.source.repository,
      tag: agentLayer.source.tag,
      commit_sha: agentLayer.source.commit_sha,
      adapter_digest_sha256: agentLayer.adapter_digest_sha256,
    },
    policy: {
      max_candidates: maxCandidates,
      no_execution: true,
      no_activation: true,
      no_permission_grants: true,
    },
    candidates,
  };

  return {
    ...canonical,
    selection_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      proposed: candidates.length,
      execution_grants: 0,
      activated: 0,
    },
  };
}

module.exports = { selectSpecialists };
