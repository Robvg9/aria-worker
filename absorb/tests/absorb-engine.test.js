'use strict';

const assert = require('node:assert/strict');

(async () => {
  const absorb = await import('../../supabase/functions/_shared/absorb-engine.mjs');

  assert.equal(absorb.ABSORB_VERSION, '1.0.0');
  assert.equal(absorb.ABSORB_STAGES.length, 14);
  assert.ok(absorb.ABSORB_STAGES.includes('REPLACE_OR_RETIRE'));

  const source = absorb.normalizeGithubSource({ url: 'https://github.com/affaan-m/ECC', ref: 'v2.2.3' });
  assert.deepEqual(source, {
    source_type: 'github',
    owner: 'affaan-m',
    repo: 'ECC',
    ref: 'v2.2.3',
    canonical_url: 'https://github.com/affaan-m/ECC/tree/v2.2.3'
  });

  assert.throws(() => absorb.normalizeGithubSource({ url: 'https://example.com/acme/tool' }), /github_url_not_allowed/);
  assert.throws(() => absorb.normalizeGithubSource({ owner: 'bad/owner', repo: 'x' }), /github_owner_invalid/);
  assert.throws(() => absorb.normalizeGithubSource({ owner: 'acme', repo: 'tool', ref: '../main' }), /github_ref_invalid/);

  const fakeFetch = async (url) => {
    if (url.endsWith('/repos/acme/tool')) return new Response(JSON.stringify({
      full_name: 'acme/tool', default_branch: 'main', visibility: 'public', archived: false, license: { spdx_id: 'MIT' }
    }), { status: 200 });
    if (url.endsWith('/commits/main')) return new Response(JSON.stringify({
      sha: '0123456789abcdef0123456789abcdef01234567'
    }), { status: 200 });
    if (url.includes('/git/trees/0123456789abcdef0123456789abcdef01234567')) return new Response(JSON.stringify({
      truncated: false,
      tree: [
        { path: 'agents/demo.md', type: 'blob', sha: 'a'.repeat(40), size: 10 },
        { path: 'skills/demo/SKILL.md', type: 'blob', sha: 'b'.repeat(40), size: 20 },
        { path: 'commands/demo.md', type: 'blob', sha: 'e'.repeat(40), size: 30 },
        { path: 'tests/demo.test.js', type: 'blob', sha: 'c'.repeat(40), size: 30 },
        { path: 'hooks/pretool.sh', type: 'blob', sha: 'd'.repeat(40), size: 40 }
      ]
    }), { status: 200 });
    throw new Error('unexpected_url:' + url);
  };

  const inventory = await absorb.inspectGithubSource({ owner: 'acme', repo: 'tool' }, { fetchImpl: fakeFetch });
  assert.equal(inventory.source.commit_sha, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(inventory.complete_tree, true);
  assert.equal(inventory.deterministic, true);
  assert.equal(inventory.execution_policy.external_code_execution, 'FORBIDDEN');
  assert.equal(inventory.summary.capability_unit_counts.agents, 1);
  assert.equal(inventory.summary.capability_unit_counts.skills, 1);
  assert.equal(inventory.summary.capability_unit_counts.commands, 1);

  const caps = absorb.buildCapabilityIndex(inventory);
  assert.equal(caps.length, 4);
  assert.ok(caps.every(x => x.status === 'DISCOVERED'));
  assert.ok(caps.every(x => x.verification_state === 'NOT_VERIFIED'));

  const plan = absorb.buildAbsorptionPlan({ source: inventory.source, requestedCapabilities: ['browser_automation'] });
  assert.equal(plan.external_code_execution, false);
  assert.equal(plan.governance.safe_default, true);
  assert.equal(plan.stages.length, 14);
  assert.equal(plan.stages.filter(x => x.auto_execute).length, 0);

  assert.equal(absorb.transitionStatus('DISCOVERED', 'INSPECTED'), 'INSPECTED');
  assert.equal(absorb.transitionStatus('INDEXED', 'VERIFIED'), 'VERIFIED');
  assert.throws(() => absorb.transitionStatus('DISCOVERED', 'ENABLED'), /absorb_invalid_transition/);
  assert.throws(() => absorb.transitionStatus('VERIFIED', 'DISCOVERED'), /absorb_invalid_transition/);

  const identity1 = await absorb.buildAbsorptionIdentity(inventory, caps);
  const identity2 = await absorb.buildAbsorptionIdentity(inventory, caps);
  assert.equal(identity1, identity2);
  assert.match(identity1, /^[0-9a-f]{64}$/);

  console.log('absorb-engine: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
