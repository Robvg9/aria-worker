#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

const NON_RELEASE_PATTERNS = [
  /^tests\//,
  // This is a runner-only proof harness for a manual, frozen-scope E2E; it ships no runtime artifact.
  /^scripts\/mission-wonder-2-package3-live-e2e\.cjs$/,
  /^\.github\/workflows\//,
  // A3 PowerShell/shell/Python runner helpers are operator tooling for the isolated
  // presence pilot, not code shipped in the public aria Worker release artifact.
  /^\.github\/scripts\/mission-wonder-2-step3-a3-/,
  /^scripts\/release-bearing\.js$/,
  /^docs\//,
  /^reports\//,
  /^test-results\//,
  /^README(?:\.|$)/i,
  /^CHANGELOG(?:\.|$)/i,
  /^CONTRIBUTING(?:\.|$)/i,
  /^LICENSE(?:\.|$)/i,
  /\.md$/i,
  /\.txt$/i,
];

function changedFiles(fromSha, toSha) {
  if (!toSha) throw new Error('toSha is required');
  if (!fromSha || /^0+$/.test(fromSha)) {
    return execFileSync('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', toSha], { encoding: 'utf8' })
      .split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
  }
  return execFileSync('git', ['diff', '--name-only', fromSha + '..' + toSha], { encoding: 'utf8' })
    .split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
}

function isNonReleasePath(path) {
  return NON_RELEASE_PATTERNS.some(re => re.test(path));
}

function classifyFiles(files) {
  const releaseBearingFiles = files.filter(file => !isNonReleasePath(file));
  const nonReleaseFiles = files.filter(file => isNonReleasePath(file));
  return {
    release_bearing: releaseBearingFiles.length > 0,
    release_bearing_files: releaseBearingFiles,
    non_release_files: nonReleaseFiles,
    changed_files: files,
  };
}

if (require.main === module) {
  const [, , fromSha, toSha] = process.argv;
  console.log(JSON.stringify(classifyFiles(changedFiles(fromSha, toSha)), null, 2));
}

module.exports = { NON_RELEASE_PATTERNS, changedFiles, isNonReleasePath, classifyFiles };
