'use strict';
const assert = require('node:assert/strict');
const { createSelfInspector } = require('../self-development/inspector');
const { createSelfDiagnoser } = require('../self-development/diagnosis');
const { createImprovementPlanner } = require('../self-development/planner');
const { createSelfTester } = require('../self-development/tester');
const { verifyChange } = require('../self-development/verifier');
const { createSelfRollback } = require('../self-development/rollback');
const { createSelfDocumenter } = require('../self-development/documenter');
const { createSelfDevelopmentEngine } = require('../self-development/coordinator');

(async () => {
  const source = { version:'1.8.0', identity:{name:'ARIA'}, capabilities:['self_development'], tools:['github'], connectors:['github'], providers:[], health:{status:'available'}, tests:{status:'passing'}, git:{branch:'main'} };
  const inspector = createSelfInspector({ snapshot: async () => ({ ...source, sensitive:'omit' }) });
  const inspected = await inspector.inspect({ include:['version','identity','git'] });
  assert.equal(inspected.status,'succeeded');
  assert.equal(inspected.snapshot.identity.name,'ARIA');
  assert.equal('sensitive' in inspected.snapshot,false);

  const diagnoser = createSelfDiagnoser({ rules:[{ id:'test-gap', severity:'medium', description:'tests missing', check: s => s.tests.status !== 'passing' }] });
  assert.equal((await diagnoser.diagnose(source)).findings.length,0);

  const planner = createImprovementPlanner({ allowMutation: async c => c.path.endsWith('.js') });
  const plan = await planner.plan({ objective:'improve self state', findings:[{id:'x'}], proposed_changes:[{type:'modify_file',path:'core.js'}] });
  assert.equal(plan.changes[0].status,'proposed');

  const tester = createSelfTester({ run: async () => ({ status:'passed', summary:'ok', details:{ assertions:3 } }) });
  const tests = await tester.test({ scope:['core.js'] });
  assert.equal(tests.status,'passed');
  assert.equal((await verifyChange({ tests, expected:{assertions:3} })).verified,true);

  const saved = new Map(); const current = new Map([['a.js','before'],['b.js','before-b']]);
  const workspace = { read: async p => current.get(p), apply: async c => { current.set(c.path,c.after); return {status:'succeeded'}; }, restore: async snap => { current.set(snap.path,snap.before); return {status:'succeeded'}; } };
  const snapshots = { save: async s => saved.set(s.path,s), load: async p => saved.get(p) || null };
  const rollback = createSelfRollback({ workspace, snapshotStore:snapshots });
  await snapshots.save({path:'a.js',before:'before'}); current.set('a.js','after');
  assert.equal((await rollback.rollback(['a.js'])).status,'rolled_back');
  assert.equal(current.get('a.js'),'before');

  let documented = null;
  const documenter = createSelfDocumenter({ write: async e => { documented=e; return {status:'succeeded',entry:e}; } });
  assert.equal((await documenter.record({objective:'x'})).status,'succeeded');
  assert.equal(documented.type,'aria.self_development');

  const engine = createSelfDevelopmentEngine({
    snapshot: async () => ({ ...source }),
    rules: [],
    workspace: { read: async p => current.get(p) || '', apply: async c => { current.set(c.path,c.after); return {status:'succeeded'}; } },
    testRunner: async () => ({status:'passed',details:{ok:true}}),
    writer: async () => ({status:'succeeded'}),
    policy:{max_risk:'low'}
  });
  const planned = await engine.improve({ proposed_changes:[{type:'modify_file',path:'safe.js',risk_level:'high',after:'x'}] });
  assert.equal(planned.status,'planned');
  assert.equal(planned.applied.length,0);

  const executed = await engine.improve({ proposed_changes:[{type:'modify_file',path:'safe.js',risk_level:'low',after:'x'}] });
  assert.equal(executed.status,'succeeded');
  assert.deepEqual(executed.applied,['safe.js']);
  console.log('BLOCK 5 SELF-DEVELOPMENT: PASS — inspection, diagnosis, planning, governed change, testing, verification, rollback and documentation boundaries verified');
})().catch(err => { console.error(err); process.exit(1); });
