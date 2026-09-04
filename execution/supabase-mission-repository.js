'use strict';

function createSupabaseMissionRepository({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch
} = {}) {
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

    if (!response.ok) {
      const error = new Error(`mission_rpc_${response.status}`);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function createMission(mission) {
    return rpc('aria_mission_create', { p_mission: mission });
  }

  async function getMission(missionId) {
    return rpc('aria_mission_get', { p_mission_id: missionId });
  }

  async function updateMission(missionId, mission) {
    return rpc('aria_mission_update', {
      p_mission_id: missionId,
      p_mission: mission
    });
  }

  async function appendEvent(missionId, event) {
    return rpc('aria_mission_append_event', {
      p_mission_id: missionId,
      p_event: event
    });
  }

  return Object.freeze({ createMission, getMission, updateMission, appendEvent });
}

module.exports = Object.freeze({ createSupabaseMissionRepository });
