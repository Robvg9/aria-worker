'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const testCommand = pkg.scripts && pkg.scripts.test;

if (typeof testCommand !== 'string' || !testCommand.trim()) {
  throw new Error('package.json must define a non-empty scripts.test command');
}

const commands = [...testCommand.matchAll(/(?:^|&&|\|\|)\s*node\s+([^\s&|;]+)/g)]
  .map((match) => match[1]);
if (commands.length === 0) {
  throw new Error('Could not extract Node test commands from scripts.test');
}

const counts = new Map();
for (const command of commands) counts.set(command, (counts.get(command) || 0) + 1);
const duplicates = [...counts.entries()]
  .filter(([, count]) => count > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log('ARIA test inventory');
console.log('-------------------');
console.log('Node command invocations:', commands.length);
console.log('Distinct command paths:', counts.size);
console.log('Repeated paths:', duplicates.length);

if (duplicates.length === 0) {
  console.log('No repeated command paths found.');
} else {
  for (const [command, count] of duplicates) {
    console.log(`REVIEW duplicate: ${command} (${count} invocations)`);
  }
  console.log('Note: confirm that repeats are unintended before removing them.');
}
