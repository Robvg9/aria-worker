'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const api=fs.readFileSync('supabase/functions/aria-app-api-v3/index.ts','utf8');
const direct=fs.readFileSync('supabase/functions/aria-direct-v1/index.ts','utf8');
const pwa=fs.readFileSync('pwa/src/App.tsx','utf8');
assert.match(api,/deriveOperationalDiagnostic/);
assert.match(api,/async function missionDiagnosticForUser/);
assert.match(api,/async function operationalHealth/);
assert.match(api,/path\.endsWith\(\"\/diagnostics\/health\"\)/);
assert.match(api,/path\.endsWith\(\"\/diagnostic\"\)/);
for(const field of ['trace_id','request_id','pwa_build','runtime_version','diagnostic_contract_version']) assert.match(api,new RegExp(field),field+' must propagate through mission intake');
for(const field of ['trace_id','request_id','runtime_version','diagnostic_contract_version']) assert.match(direct,new RegExp(field),field+' must originate at direct mission boundary');
for(const header of ['x-aria-trace-id','x-aria-request-id','x-aria-pwa-build']) {
  assert.match(pwa,new RegExp(header),header+' must be sent by PWA');
  assert.match(api,new RegExp(header.replaceAll('-','[-_]')),header+' must be handled by the API boundary');
}
assert.match(api,/source_sha:/,'POST mission intake must persist the release SHA when PWA build is a commit SHA');
assert.match(pwa,/OperationalHealthPanel/);
assert.match(pwa,/diagnosticResult/);
assert.match(pwa,/DIAGNÓSTICO OPERACIONAL/);
assert.match(pwa,/Intentos observados/);
assert.match(pwa,/Siguiente acción/);
console.log('ARIA APP API V3 DIAGNOSTICS CONTRACT: PASS');
