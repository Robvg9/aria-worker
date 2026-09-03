'use strict';

async function verifyChange({ tests = null, inspection = null, expected = null } = {}) {
  if (!tests || tests.status !== 'passed') return { verified: false, reason: 'tests_failed' };
  if (typeof inspection === 'function') {
    try {
      if ((await inspection()) !== true) return { verified: false, reason: 'post_change_inspection_failed' };
    } catch (_) { return { verified: false, reason: 'post_change_inspection_error' }; }
  }
  if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) if (JSON.stringify(tests.details?.[key]) !== JSON.stringify(value)) return { verified: false, reason: 'expected_result_mismatch' };
  }
  return { verified: true, reason: 'tests_and_inspection_passed' };
}

module.exports = { verifyChange };
