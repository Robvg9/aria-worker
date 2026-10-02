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
assert.ok(catalog.includes('"file": "tests/'),'catalog entries must use repository-relative test paths');
assert.match(catalog,/includedInNpmTest/);

assert.match(catalog,/export const TEST_CATALOG_STATS/);
assert.ok(catalog.includes('total: TEST_CATALOG.length'),'canonical total must derive from TEST_CATALOG.length');
assert.ok(catalog.includes('npmTest: TEST_CATALOG.filter'),'canonical npm-test count must derive from TEST_CATALOG');
assert.ok(catalog.includes('catalogOnly: TEST_CATALOG.filter'),'canonical catalog-only count must derive from TEST_CATALOG');
assert.ok(catalog.includes('export function filterTestCatalog'),'canonical filtering must live in the catalog module');
assert.ok(catalog.includes('Object.freeze'),'canonical stats must be immutable');

const catalogIds=[...catalog.matchAll(/"id": "([^"]+)"/g)].map(match=>match[1]);
const catalogFiles=[...catalog.matchAll(/"file": "([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(catalogIds).size,catalogIds.length,'test catalog IDs must remain unique');
assert.equal(new Set(catalogFiles).size,catalogFiles.length,'test catalog files must remain unique');
assert.equal(catalogIds.length,catalogFiles.length,'every catalog entry must have exactly one id and file');

const repositoryTestFiles=fs.readdirSync(path.join(root,'tests'))
  .filter(file=>file.endsWith('.test.js'))
  .sort();
assert.deepEqual(
  catalogFiles.map(file=>file.startsWith('tests/') ? file.slice('tests/'.length) : file).sort(),
  repositoryTestFiles,
  'PWA test catalog must contain exactly the repository test suite: no missing or stale entries'
);
assert.ok(catalog.includes("TEST_CATALOG_VERSION = '2026-10-02-canonical'"),'canonical catalog version must be explicit');

assert.ok(app.includes('TEST_CATALOG_STATS.total'),'PWA totals must come from canonical stats');
assert.ok(app.includes('TEST_CATALOG_STATS.npmTest'),'PWA npm-test count must come from canonical stats');
assert.ok(app.includes('filterTestCatalog(q, testCategory)'),'PWA test filtering must use canonical catalog filtering');
assert.equal(app.includes('TEST_CATALOG.length'),false,'PWA views must not calculate the canonical test total independently');
assert.equal(app.includes('TEST_CATALOG.filter(test => test.includedInNpmTest).length'),false,'PWA views must not calculate npm-test counts independently');
assert.equal(app.includes('Array.from(new Set(TEST_CATALOG.map'),false,'PWA views must not rebuild catalog categories independently');
assert.ok((catalog.match(/"id": "/g)||[]).length >= 200,'test catalog should include the full repository test suite');
assert.match(css,/\.testCatalogRow/);
assert.match(css,/\.testDetailModal/);
assert.match(presentation,/missionActivityLabel/);
assert.match(app,/missionActivityLabel/);
console.log('PWA CAPABILITIES TEST CENTER CONTRACT: PASS');
