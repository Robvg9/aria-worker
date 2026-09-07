'use strict';
const assert = require('assert');
const { SCOPES, digest, sign, verifySignature, createSecurityControlPlane } = require('../security/aria-security-v2');
const { createSecureDispatch } = require('../security/secure-dispatch');

(async () => {
  const audits=[];
  const secret='0123456789abcdef-secret';
  const security=createSecurityControlPlane({ secret, auditStore:{append:e=>audits.push(e)}, now:()=> '2026-09-07T23:00:00.000Z' });

  security.registerIdentity({id:'agent-coder',kind:'agent',capabilities:['code.read','code.write'],maxRisk:'high'});
  security.grantCapabilities('agent-coder',['code.read','code.write'],'high');
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.read',risk:'read',scope:'executors',operation:'inspect'}).allowed,true);
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'shell.exec',risk:'low',scope:'executors',operation:'run'}).reason,'capability_denied');
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'destructive',scope:'executors',operation:'delete'}).reason,'risk_exceeded');
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge',requireHumanGate:true}).reason,'human_gate_required');

  const envelope=security.issueActionEnvelope({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge'});
  assert.strictEqual(security.verifyActionEnvelope(envelope).valid,true);
  assert.strictEqual(security.verifyActionEnvelope({...envelope,signature:'0'.repeat(64)}).valid,false);
  assert.throws(()=>createSecurityControlPlane().issueActionEnvelope({identityId:'x',capability:'x',operation:'x'}),/signing_key_required/);

  let executed=0;
  const dispatch=createSecureDispatch({security,executor:async()=>{executed++;return{ok:true};}});
  assert.strictEqual((await dispatch.dispatch({envelope})).executed,true);
  security.killSwitch('executors','test-stop');
  assert.strictEqual((await dispatch.dispatch({envelope})).reason,'kill_switch_active');
  assert.strictEqual(executed,1);
  assert.strictEqual(security.releaseKillSwitch('executors','bad', '0'.repeat(64)).reason,'invalid_release_proof');
  const releaseReason='resume-test';
  const proof=security.releaseProof('executors',releaseReason);
  assert.strictEqual(security.releaseKillSwitch('executors',releaseReason,proof).released,true);

  security.revokeCapability('agent-coder','code.write');
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge'}).reason,'capability_denied');
  security.grantCapabilities('agent-coder',['code.read'],'high');
  security.revokeIdentity('agent-coder');
  assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.read',risk:'read',scope:'executors',operation:'inspect'}).reason,'identity_revoked');

  security.registerIdentity({id:'agent-device',kind:'agent',capabilities:['device.read','device.write'],maxRisk:'medium'});
  security.grantCapabilities('agent-device',['device.read','device.write'],'medium');
  const snap=security.snapshot();
  assert.ok(!JSON.stringify(snap).includes(secret));
  security.emergencyStop('global-test');
  for (const scope of SCOPES) assert.strictEqual(security.isStopped(scope),true);
  security.recover(snap);
  for (const scope of SCOPES) assert.strictEqual(security.isStopped(scope),false);
  assert.strictEqual(security.integrity().valid,true);
  assert.strictEqual(security.auditIntegrity().valid,true);
  assert.strictEqual(security.auditIntegrity().count,audits.length);
  assert.ok(audits.every(e=>!JSON.stringify(e).includes(secret)));
  assert.ok(audits.some(e=>e.action==='kill.global_activate'));
  assert.strictEqual(digest(snap).length,64);
  const signature=sign({a:1},secret);
  assert.strictEqual(verifySignature({a:1},secret,signature),true);
  console.log('ARIA Security 2.0 contract tests passed');
})().catch(error=>{ console.error(error); process.exit(1); });
