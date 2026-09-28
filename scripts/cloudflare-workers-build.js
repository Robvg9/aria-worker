const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const pwaDir = path.join(root, 'pwa');
const distDir = path.join(pwaDir, 'dist');
const buildSha =
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  'local';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['--prefix', 'pwa', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
run('npm', ['--prefix', 'pwa', 'run', 'build'], {
  env: { VITE_BUILD: buildSha },
});

const index = path.join(distDir, 'index.html');
const manifest = path.join(distDir, 'manifest.json');
const swSource = path.join(pwaDir, 'public', 'sw.js');

fs.copyFileSync(index, path.join(distDir, 'index-' + buildSha + '.html'));
fs.copyFileSync(manifest, path.join(distDir, 'manifest-' + buildSha + '.json'));

const sw = fs.readFileSync(swSource, 'utf8').replaceAll('__BUILD__', buildSha);
fs.writeFileSync(path.join(distDir, 'sw-' + buildSha + '.js'), sw);

const workerPath = path.join(root, 'worker.js');
const worker = fs.readFileSync(workerPath, 'utf8');
const preparedWorker = worker.replaceAll('__PWA_BUILD__', buildSha);
if (preparedWorker === worker) {
  throw new Error('Cloudflare Workers Build could not prepare __PWA_BUILD__.');
}
fs.writeFileSync(workerPath, preparedWorker);

console.log('WORKERS_NATIVE_BUILD_OK ' + buildSha);
