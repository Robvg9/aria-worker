'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createAtomicHeartbeatWriter(filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('filePath must be a non-empty string');
  }

  const retryAttempts = options.retryAttempts ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 25;
  if (!Number.isInteger(retryAttempts) || retryAttempts < 1) {
    throw new TypeError('retryAttempts must be a positive integer');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new TypeError('retryDelayMs must be a non-negative finite number');
  }

  const targetPath = path.resolve(filePath);
  let sequence = 0;
  let writeQueue = Promise.resolve();

  return function writeHeartbeatSnapshot(contents) {
    if (typeof contents !== 'string' || contents.length === 0) {
      return Promise.reject(new TypeError('heartbeat snapshot must be a non-empty string'));
    }

    const operation = writeQueue.catch(() => undefined).then(async () => {
      const temporaryPath = targetPath + '.' + process.pid + '.' + Date.now() + '.' + (++sequence) + '.tmp';
      try {
        // The temporary file is a sibling of the destination so rename stays on one volume.
        // Readers keep seeing the previous complete JSON until the replacement is ready.
        await fs.promises.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });

        for (let attempt = 1; ; attempt += 1) {
          try {
            await fs.promises.rename(temporaryPath, targetPath);
            break;
          } catch (error) {
            if (attempt >= retryAttempts || !RETRYABLE_RENAME_CODES.has(error?.code)) throw error;
            await wait(retryDelayMs * attempt);
          }
        }
      } finally {
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      }
    });

    writeQueue = operation;
    return operation;
  };
}

module.exports = { createAtomicHeartbeatWriter };
