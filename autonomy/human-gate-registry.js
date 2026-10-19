'use strict';

/**
 * ARIA Human Gate Registry
 * 
 * This module manages the rejection/approval state of Human Gates.
 * 
 * Mission: mission_hg_REJ_1790865948001
 * Status: REJECTED_PROTECTED
 * 
 * Note: This file is used to track and resolve gate rejections.
 */

const REJECTED_GATES = new Set([
  'mission_hg_REJ_1790865948001'
]);

function isGateRejected(gateId) {
  return REJECTED_GATES.has(gateId);
}

module.exports = Object.freeze({
  isGateRejected
});
