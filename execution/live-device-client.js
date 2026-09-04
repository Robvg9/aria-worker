'use strict';

function createServiceDeviceClient({ supabaseUrl, serviceRoleKey, fetchImpl = globalThis.fetch } = {}) {
  if (!supabaseUrl || typeof supabaseUrl !== 'string') throw new TypeError('supabaseUrl required');
  if (!serviceRoleKey || typeof serviceRoleKey !== 'string') throw new TypeError('serviceRoleKey required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  const base = supabaseUrl.replace(/\/$/, '');
  async function rpc(name, body) {
    const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify(body || {})
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) throw new Error(`device_rpc_${response.status}`);
    return data;
  }

  async function enqueue(input) {
    return rpc('enqueue_execution_job_gateway', {
      p_job_id: input.job_id,
      p_mission_id: input.mission_id,
      p_device_id: input.device_id,
      p_operation: input.operation,
      p_command: input.command,
      p_cwd: input.cwd || null,
      p_timeout_ms: input.timeout_ms,
      p_policy: input.policy || {},
      p_metadata: input.metadata || {}
    });
  }

  async function get(jobId) {
    return rpc('get_execution_job_gateway', { p_job_id: jobId });
  }

  return Object.freeze({ enqueue, get });
}

module.exports = Object.freeze({ createServiceDeviceClient });
