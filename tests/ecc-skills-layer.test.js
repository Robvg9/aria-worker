'use strict';

const assert = require('node:assert/strict');
const { buildSkillsLayer } = require('../scripts/ecc-skills-layer');

const compiled = {
  schema: 'aria.ecc-compiled-capabilities.v1',
  deterministic: true,
  compile_digest_sha256: 'compile',
  source: { repository: 'ecc', tag: 'v2.2.3', commit_sha: 'commit' },
  compiled_capabilities: [
    {
      capability_id: 'skill-1',
      kind: 'skill',
      name: 'verification-loop',
      source: { path: 'skills/verification-loop/SKILL.md', sha: 'sha', commit_sha: 'commit', tag: 'v2.2.3' },
      target_surfaces: ['codex'],
      runtime_binding: { state: 'UNBOUND' },
      lifecycle: { activation_state: 'DISABLED' },
      verification: { state: 'NOT_VERIFIED' },
    },
    {
      capability_id: 'agent-1',
      kind: 'agent',
      name: 'reviewer',
      source: { path: 'agents/reviewer.md', sha: 'a', commit_sha: 'commit', tag: 'v2.2.3' },
      target_surfaces: [],
      verification: { state: 'NOT_VERIFIED' },
    },
  ],
};

const layer = buildSkillsLayer(compiled);
assert.equal(layer.schema, 'aria.ecc-skills-layer.v1');
assert.equal(layer.summary.total_skills, 1);
assert.equal(layer.summary.loaded, 0);
assert.equal(layer.summary.enabled, 0);
assert.equal(layer.summary.execution_grants, 0);
assert.equal(layer.skills[0].load_policy, 'ON_DEMAND');
assert.equal(layer.skills[0].source_mode, 'LAZY_READ');
assert.equal(layer.skills[0].instruction_state, 'NOT_LOADED');
assert.equal(layer.skills[0].activation_state, 'DISABLED');
assert.deepEqual(layer.skills[0].permissions, []);
assert.equal(layer.layer_digest_sha256.length, 64);

assert.throws(
  () => buildSkillsLayer({ schema: 'wrong' }),
  /Unsupported compiled capability schema/,
);

const reversed = buildSkillsLayer({
  ...compiled,
  compiled_capabilities: [...compiled.compiled_capabilities].reverse(),
});
assert.equal(layer.layer_digest_sha256, reversed.layer_digest_sha256);

console.log('ECC SKILLS LAYER TEST: PASS');
