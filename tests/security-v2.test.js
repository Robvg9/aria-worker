'use strict';
const assert = require('assert');
const { SCOPES, digest, sign, verifySignature, createSecurityControlPlane } = require('../security/aria-security-v2');

const audits=[];
const security=createSecurityControlPlane({ secret:'0123456789abcdef-secret', auditStore:{append:e=>audits.push(e)}, now:()=> '2026-09-07T23:00:00.000Z' });

security.registerIdentity({id:'agent-coder',kind:'agent',capabilities:['code.read','code.write'],maxRisk:'high'});
security.grantCapabilities('agent-coder',['code.read','code.write'],'high');
assert.deepStrictEqual(security.authorize({identityId:'agent-coder',capability:'code.read',risk:'read',scope:'executors',operation:'inspect'}).allowed,true);
assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'shell.exec',risk:'low',scope:'executors',operation:'run'}).reason,'capability_denied');
assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'destructive',scope:'executors',operation:'delete'}).reason,'risk_exceeded');
assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge',requireHumanGate:true}).reason,'human_gate_required');

const envelope=security.issueActionEnvelope({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge'});
assert.strictEqual(security.verifyActionEnvelope(envelope).valid,true);
assert.strictEqual(security.verifyActionEnvelope({...envelope,signature:'0'.repeat(64)}).valid,false);

security.revokeCapability('agent-coder','code.write');
assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.write',risk:'high',scope:'executors',operation:'merge'}).reason,'capability_denied');
security.grantCapabilities('agent-coder',['code.read'],'high');
security.revokeIdentity('agent-coder');
assert.strictEqual(security.authorize({identityId:'agent-coder',capability:'code.read',risk:'read',scope:'executors',operation:'inspect'}).reason,'identity_revoked');

security.registerIdentity({id:'agent-device',kind:'agent',capabilities:['device.read','device.write'],maxRisk:'medium'});
security.grantCapabilities('agent-device',['device.read','device.write'],'medium');
security.killSwitch('executors','test-stop');
assert.strictEqual(security.authorize({identityId:'agent-device',capability:'device.read',risk:'read',scope:'executors',operation:'inspect'}).reason,'kill_switch_active');
assert.strictEqual(security.isStopped('executors'),true);
security.releaseKillSwitch('executors');
assert.strictEqual(security.isStopped('executors'),false);
security.emergencyStop('global-test');
for (const scope of SCOPES) assert.strictEqual(security.isStopped(scope),true);
assert.strictEqual(security.verifyActionEnvelope(envelope).reason,'kill_switch_active');
security.releaseKillSwitch('missions'); security.releaseKillSwitch('agents'); security.releaseKillSwitch('executors'); security.releaseKillSwitch('self_development'); security.releaseKillSwitch('self_modification');

const snap=security.snapshot();
assert.strictEqual(security.integrity().valid,true);
assert.strictEqual(digest(snap).length,64);
const signature=sign({a:1},'0123456789abcdef-secret');
assert.strictEqual(verifySignature({a:1},signature,'0123456789abcdef-secret'),true);
assert.ok(audits.some(e=>e.action==='kill.global_activate'));
console.log('ARIA Security 2.0 contract tests passed');
