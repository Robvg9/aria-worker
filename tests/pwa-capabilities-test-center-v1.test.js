const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const catalog=fs.readFileSync(path.join(root,'pwa/src/testCatalog.ts'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');
const presentation=fs.readFileSync(path.join(root,'pwa/src/missionPresentation.ts'),'utf8');

assert.match(app,/TEST_CATALOG/);
assert.match(app,/TEST_CATALOG_VERSION/);
assert.match(app,/tests.*as const/);
assert.match(app,/CATÁLOGO DE PRUEBAS/);
assert.match(app,/Cómo funciona/);
assert.match(app,/Qué capacidad comprueba/);
assert.match(app,/Incluidos en npm test/);
const capabilityBlock=app.slice(app.indexOf('function CapabilityCenter('),app.indexOf('function MissionDetail(',app.indexOf('function CapabilityCenter(')));
assert.doesNotMatch(capabilityBlock,/Nueva misión/);
assert.doesNotMatch(capabilityBlock,/onMission/);
assert.match(catalog,/export const TEST_CATALOG/);
assert.match(catalog,/"file": "tests\//);
assert.match(catalog,/includedInNpmTest/);

assert.match(catalog,/export const TEST_CATALOG_STATS/);
assert.match(catalog,/total: TEST_CATALOG\\.length/);
assert.match(catalog,/npmTest: TEST_CATALOG\\.filter/);
assert.match(catalog,/catalogOnly: TEST_CATALOG\\.filter/);
assert.match(catalog,/function filterTestCatalog/);
assert.match(catalog,/Object\\.freeze/);

const catalogIds=[...catalog.matchAll(/"id": "([^"]+)"/g)].map(match=>match[1]);
const catalogFiles=[...catalog.matchAll(/"file": "([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(catalogIds).size,catalogIds.length,'test catalog IDs must remain unique');
assert.equal(new Set(catalogFiles).size,catalogFiles.length,'test catalog files must remain unique');
assert.equal(catalogIds.length,catalogFiles.length,'every catalog entry must have exactly one id and file');

assert.match(app,/TEST_CATALOG_STATS\\.total/);
assert.match(app,/TEST_CATALOG_STATS\\.npmTest/);
assert.match(app,/filterTestCatalog\(q, testCategory\)/);
assert.doesNotMatch(app,/TEST_CATALOG\\.length/,'PWA views must not calculate the canonical test total independently');
assert.doesNotMatch(app,/TEST_CATALOG\\.filter\(test => test\\.includedInNpmTest\)\\.length/,'PWA views must not calculate npm-test counts independently');
assert.doesNotMatch(app,/Array\\.from\\(new Set\\(TEST_CATALOG\\.map/,'PWA views must not rebuild catalog categories independently');
assert.ok((catalog.match(/"id": "/g)||[]).length >= 200,'test catalog should include the full repository test suite');
assert.match(css,/\.testCatalogRow/);
assert.match(css,/\.testDetailModal/);
assert.match(presentation,/missionActivityLabel/);
assert.match(app,/missionActivityLabel/);
console.log('PWA CAPABILITIES TEST CENTER CONTRACT: PASS');
