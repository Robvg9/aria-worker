'use strict';

const crypto = require('node:crypto');

const KNOWN_PLATFORMS = new Set(['pc', 'android', 'server', 'browser', 'unspecified']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean))].sort();
}

function resolveContext(input = {}) {
  const mission = input.mission || {};
  const project = input.project || {};
  const session = input.session || {};
  const runtime = input.runtime || {};
  const constraints = input.constraints || {};
  const provenance = input.provenance || {};

  const platform = clean(runtime.platform).toLowerCase() || 'unspecified';
  if (!KNOWN_PLATFORMS.has(platform)) throw new Error(`Unsupported context platform: ${platform}`);

  const objective = clean(mission.objective);
  if (!objective) throw new Error('Context objective is required');

  const conflicts = [];
  const requiredKinds = uniqueSorted(constraints.required_capability_kinds);
  const preferredSurfaces = uniqueSorted(constraints.preferred_surfaces);
  const forbiddenSurfaces = uniqueSorted(constraints.forbidden_surfaces);
  const deviceIds = uniqueSorted(runtime.device_ids);

  const overlap = preferredSurfaces.filter(x => forbiddenSurfaces.includes(x));
  for (const surface of overlap) {
    conflicts.push({
      code: 'PREFERRED_AND_FORBIDDEN_SURFACE',
      value: surface,
      severity: 'HIGH',
    });
  }

  if (constraints.execution_allowed === true && constraints.require_human_approval === false) {
    conflicts.push({
      code: 'UNSAFE_AUTONOMOUS_EXECUTION_REQUEST',
      severity: 'HIGH',
      message: 'Context resolution never grants autonomous execution authority',
    });
  }

  const canonical = {
    schema: 'aria.ecc-context.v1',
    deterministic: true,
    state: conflicts.length ? 'CONFLICT' : 'RESOLVED',
    mission: {
      id: clean(mission.id) || null,
      objective,
      acceptance: clean(mission.acceptance) || null,
    },
    project: {
      id: clean(project.id) || null,
      name: clean(project.name) || null,
    },
    session: {
      id: clean(session.id) || null,
      continuation_key: clean(session.continuation_key) || null,
    },
    runtime: {
      platform,
      device_ids: deviceIds,
      network_state: clean(runtime.network_state).toLowerCase() || 'unknown',
    },
    constraints: {
      required_capability_kinds: requiredKinds,
      preferred_surfaces: preferredSurfaces,
      forbidden_surfaces: forbiddenSurfaces,
      execution_allowed: false,
      require_human_approval: true,
    },
    provenance: {
      inventory_digest_sha256: clean(provenance.inventory_digest_sha256) || null,
      registry_digest_sha256: clean(provenance.registry_digest_sha256) || null,
      compile_digest_sha256: clean(provenance.compile_digest_sha256) || null,
    },
    conflicts: conflicts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };

  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');

  return {
    ...canonical,
    context_digest_sha256: digest,
  };
}

module.exports = { resolveContext, uniqueSorted };
