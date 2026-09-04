'use strict';

function createLiveDeviceClient({ gatewayUrl, token, deviceId, fetchImpl = globalThis.fetch, pollMs = 1500, waitMs = 120000 } = {}) {
  if (!gatewayUrl || typeof gatewayUrl !== 'string') throw new TypeError('gatewayUrl required');
  if (!token || typeof token !== 'string') throw new TypeError('token required');
  if (!deviceId || typeof deviceId !== 'string') throw new TypeError('deviceId required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  const base = gatewayUrl.replace(/\/$/, '');
  const headers = () => ({
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'x-aria-device-id': deviceId
  });

  async function request(path, body) {
    const response = await fetchImpl(`${base}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) throw new Error(`device_gateway_${response.status}`);
    return data;
  }

  async function enqueue(input) {
    return request('/v1/internal/device-jobs/enqueue', input);
  }

  async function get(jobId) {
    return request(`/v1/internal/device-jobs/${encodeURIComponent(jobId)}`, { job_id: jobId });
  }

  async function heartbeat(capabilities = ['shell.execute'], agentType = 'android-termux') {
    return request('/v1/devices/heartbeat', { device_id: deviceId, agent_type: agentType, capabilities });
  }

  return Object.freeze({ enqueue, get, heartbeat, pollMs, waitMs });
}

module.exports = Object.freeze({ createLiveDeviceClient });
