#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');

const NON_RELEASE_PATTERNS = [
  /^tests\//,
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
      .split(/?
/).map(s => s.trim()).filter(Boolean);
  }
  return execFileSync('git', ['diff', '--name-only', fromSha + '..' + toSha], { encoding: 'utf8' })
    .split(/?
/).map(s => s.trim()).filter(Boolean);
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
