#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const PWA_DIST = path.join(ROOT, 'pwa', 'dist');

function canonicalText(value) {
  return String(value).replace(/\r/g, '');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(canonicalText(value)).digest('hex');
}

function sha256File(filePath) {
  return sha256Text(fs.readFileSync(filePath, 'utf8'));
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function buildRuntimeServiceWorker(source, sha) {
  const lines = String(source).split(/\r?\n/);
  lines[0] = 'const CACHE = ' + JSON.stringify('aria-pwa-' + sha) + ';';
  return lines.join('\n');
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp("<meta\\s+name=['\"]" + name + "['\"]\\s+content=['\"]([^'\"]+)['\"]", 'i'),
    new RegExp("<meta\\s+content=['\"]([^'\"]+)['\"]\\s+name=['\"]" + name + "['\"]", 'i'),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return match[1];
  }
  throw new Error('Missing PWA metadata: ' + name);
}

function prepareReleaseArtifact(sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Invalid release SHA: ' + sha);
  const indexPath = path.join(PWA_DIST, 'index.html');
  const manifestPath = path.join(PWA_DIST, 'manifest.json');
  const swPath = path.join(ROOT, 'pwa', 'public', 'sw.js');
  const workerPath = path.join(ROOT, 'worker.js');

  for (const file of [indexPath, manifestPath, swPath, workerPath]) {
    if (!fs.existsSync(file)) throw new Error('Missing release source/artifact: ' + file);
  }

  const indexHtml = readUtf8(indexPath);
  const manifest = JSON.parse(readUtf8(manifestPath));
  const sw = buildRuntimeServiceWorker(readUtf8(swPath), sha);
  const worker = readUtf8(workerPath).replace('const PWA_BUILD = "__PWA_BUILD__";', 'const PWA_BUILD = "' + sha + '";');
  if (!worker.includes('const PWA_BUILD = "' + sha + '";')) {
    throw new Error('Worker PWA_BUILD does not match release SHA');
  }

  const release = {
    schema: 'aria-delivery-determinism-v1',
    release_sha: sha,
    release_bearing: true,
    pwa_catalog: {
      version: extractMeta(indexHtml, 'aria-test-catalog-version'),
      total: Number(extractMeta(indexHtml, 'aria-test-catalog-total')),
    },
    pwa: {
      index: { path: 'index-' + sha + '.html', sha256: sha256File(indexPath) },
      manifest: { path: 'manifest-' + sha + '.json', sha256: sha256File(manifestPath), name: manifest.name || null },
      service_worker: { path: 'sw-' + sha + '.js', sha256: sha256Text(sw) },
    },
    worker: {
      sha256: sha256Text(worker),
      pwa_build: sha,
    },
    live: {
      version_path: '/pwa/version.json',
      shell_path: '/pwa/',
      immutable_index: '/pwa/index-' + sha + '.html',
      immutable_manifest: '/pwa/manifest-' + sha + '.json',
      immutable_service_worker: '/pwa/sw-' + sha + '.js',
    },
  };

  const output = path.join(ROOT, '.delivery-release-' + sha + '.json');
  fs.writeFileSync(output, JSON.stringify(release, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', marker: 'ARIA_RELEASE_ARTIFACT_READY', output, release }, null, 2));
  return release;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'cache-control': 'no-cache' },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error('LIVE request failed ' + response.status + ' ' + url + ': ' + text.slice(0, 500));
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function verifyLive(sha, baseUrl, manifestPath) {
  const expected = JSON.parse(readUtf8(manifestPath));
  const base = baseUrl.replace(/\/$/, '');

  const version = JSON.parse(await fetchText(base + '/pwa/version.json?probe=' + sha));
  if (version.build !== sha) throw new Error('LIVE_BUILD_MISMATCH expected=' + sha + ' observed=' + version.build);

  const shell = await fetchText(base + '/pwa/?probe=' + sha);
  if ((!shell.includes("aria-build' content='" + sha)) && (!shell.includes('aria-build" content="' + sha))) {
    throw new Error('LIVE PWA shell does not expose expected build SHA');
  }
  if (!shell.includes('sw-' + sha + '.js')) throw new Error('LIVE PWA shell does not reference immutable service worker');

  const targets = [
    ['index', base + '/pwa/index-' + sha + '.html'],
    ['manifest', base + '/pwa/manifest-' + sha + '.json'],
    ['service_worker', base + '/pwa/sw-' + sha + '.js'],
  ];
  for (const [kind, url] of targets) {
    const body = await fetchText(url + '?probe=' + sha);
    const actual = sha256Text(body);
    if (actual !== expected.pwa[kind].sha256) throw new Error('LIVE artifact hash mismatch for ' + kind);
  }

  const liveCatalogVersion = extractMeta(shell, 'aria-test-catalog-version');
  const liveCatalogTotal = Number(extractMeta(shell, 'aria-test-catalog-total'));
  if (liveCatalogVersion !== expected.pwa_catalog.version) throw new Error('LIVE catalog version drift');
  if (liveCatalogTotal !== expected.pwa_catalog.total) throw new Error('LIVE catalog total drift');

  console.log(JSON.stringify({
    status: 'PASS',
    marker: 'ARIA_DELIVERY_DETERMINISM_OK',
    merged_sha: sha,
    live_sha: version.build,
    catalog_version: liveCatalogVersion,
    catalog_total: liveCatalogTotal,
    artifact_hashes_verified: true,
  }, null, 2));
}

async function main() {
  const [, , command, sha, baseUrl, manifestPathArg] = process.argv;
  if (command === 'prepare') {
    prepareReleaseArtifact(sha);
    return;
  }
  if (command === 'verify-live') {
    await verifyLive(sha, baseUrl || 'https://aria.robvg9.workers.dev', manifestPathArg || path.join(ROOT, '.delivery-release-' + sha + '.json'));
    return;
  }
  throw new Error('Usage: delivery-artifact.js prepare <sha> | verify-live <sha> <baseUrl> <manifestPath>');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { canonicalText, sha256Text, sha256File, extractMeta, fetchText, buildRuntimeServiceWorker, prepareReleaseArtifact, verifyLive };
