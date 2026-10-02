'use strict';

const crypto = require('node:crypto');

function ownershipKey(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') throw new Error('deviceId is required');
  return deviceId.trim();
}

function isActive(lease, now) {
  return lease && lease.expires_at > now;
}

function claimDevice(ownership = {}, input = {}) {
  const deviceId = ownershipKey(input.device_id);
  if (!input.session_id) throw new Error('session_id is required');
  if (!Number.isFinite(input.now)) throw new Error('now is required');
  const leaseMs = Math.max(1000, Math.min(Number(input.lease_ms) || 30000, 300000));

  const current = ownership[deviceId];
  if (isActive(current, input.now) && current.session_id !== input.session_id) {
    throw new Error(`DEVICE_OWNERSHIP_CONFLICT:${deviceId}`);
  }

  const nextFence = (current?.fencing_token || 0) + 1;
  const lease = {
    device_id: deviceId,
    session_id: String(input.session_id),
    role: input.role ? String(input.role) : 'EXECUTION',
    claimed_at: input.now,
    expires_at: input.now + leaseMs,
    fencing_token: nextFence,
    lease_id: crypto.createHash('sha256')
      .update(JSON.stringify([deviceId, input.session_id, nextFence, input.now]), 'utf8')
      .digest('hex')
      .slice(0, 24),
    state: 'CLAIMED',
  };

  return { ...ownership, [deviceId]: lease };
}

function renewDevice(ownership = {}, input = {}) {
  const deviceId = ownershipKey(input.device_id);
  const current = ownership[deviceId];
  if (!current) throw new Error('DEVICE_LEASE_NOT_FOUND');
  if (current.session_id !== input.session_id) throw new Error('DEVICE_OWNERSHIP_CONFLICT');
  if (!Number.isFinite(input.now)) throw new Error('now is required');
  if (!isActive(current, input.now)) throw new Error('DEVICE_LEASE_EXPIRED');

  const leaseMs = Math.max(1000, Math.min(Number(input.lease_ms) || 30000, 300000));
  return {
    ...ownership,
    [deviceId]: {
      ...current,
      expires_at: input.now + leaseMs,
      state: 'CLAIMED',
    },
  };
}

function releaseDevice(ownership = {}, deviceId, sessionId) {
  const key = ownershipKey(deviceId);
  const current = ownership[key];
  if (!current) return { ...ownership };
  if (current.session_id !== sessionId) throw new Error('DEVICE_OWNERSHIP_CONFLICT');
  return {
    ...ownership,
    [key]: {
      ...current,
      state: 'RELEASED',
      expires_at: 0,
    },
  };
}

function reconcileOwnership(ownership = {}, now) {
  if (!Number.isFinite(now)) throw new Error('now is required');
  const next = {};
  for (const [deviceId, lease] of Object.entries(ownership)) {
    next[deviceId] = isActive(lease, now)
      ? lease
      : { ...lease, state: 'EXPIRED', expires_at: 0 };
  }
  return next;
}

module.exports = { ownershipKey, claimDevice, renewDevice, releaseDevice, reconcileOwnership };
