'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const canonical = pkg.scripts && pkg.scripts.test;

if (typeof canonical !== 'string' || !canonical.trim()) {
  throw new Error('package.json must define scripts.test before profiling');
}

// Deliberately accept only the existing simple "node <file> && node <file>" form.
// Fail closed if the canonical gate gains shell syntax that this profiler cannot preserve.
const segments = canonical.split(/\s*&&\s*/).map((part) => part.trim()).filter(Boolean);
const commands = segments.map((segment, index) => {
  const match = segment.match(/^node\s+([^\s;&|]+)$/);
  if (!match) {
    throw new Error('Unsupported canonical test command at position ' + (index + 1) + ': ' + segment);
  }
  const relativePath = match[1];
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(root + path.sep)) {
    throw new Error('Test path escapes repository root: ' + relativePath);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error('Canonical test file does not exist: ' + relativePath);
  }
  return { relativePath, absolutePath };
});

if (commands.length === 0) {
  throw new Error('No Node test commands found in scripts.test');
}

if (process.argv.includes('--list')) {
  console.log('ARIA canonical test profiling plan (no tests executed)');
  console.log('Node commands:', commands.length);
  commands.forEach((command, index) => {
    console.log(String(index + 1).padStart(3, '0') + '  ' + command.relativePath);
  });
  process.exit(0);
}

const timings = [];
const suiteStart = performance.now();
let failure = null;

for (let index = 0; index < commands.length; index += 1) {
  const command = commands[index];
  console.log('\n[PROFILE ' + (index + 1) + '/' + commands.length + '] ' + command.relativePath);
  const start = performance.now();
  const result = spawnSync(process.execPath, [command.absolutePath], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  const elapsed = performance.now() - start;
  timings.push({ path: command.relativePath, elapsed });

  if (result.error || result.status !== 0) {
    failure = {
      path: command.relativePath,
      status: result.status,
      signal: result.signal,
      error: result.error ? result.error.message : null,
    };
    break;
  }
}

const totalElapsed = performance.now() - suiteStart;
console.log('\nARIA canonical test profile summary');
console.log('Commands in canonical suite:', commands.length);
console.log('Commands executed:', timings.length);
console.log('Total elapsed: ' + (totalElapsed / 1000).toFixed(2) + ' s');

const slowest = [...timings].sort((a, b) => b.elapsed - a.elapsed).slice(0, 10);
console.log('Slowest completed commands:');
for (const item of slowest) {
  console.log('  ' + (item.elapsed / 1000).toFixed(2) + ' s  ' + item.path);
}

if (failure) {
  console.error('\nPROFILE FAILED at ' + failure.path);
  if (failure.error) console.error('Spawn error: ' + failure.error);
  if (failure.signal) console.error('Signal: ' + failure.signal);
  console.error('Exit status: ' + failure.status);
  console.error('Stopped at first failure, matching npm test fail-fast behavior.');
  process.exitCode = typeof failure.status === 'number' ? failure.status : 1;
} else {
  console.log('All profiled commands passed.');
}
