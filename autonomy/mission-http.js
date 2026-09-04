'use strict';

function createMissionHttpHandler({ startMission, auth = null } = {}) {
  if (typeof startMission !== 'function') throw new TypeError('startMission function required');
  if (auth !== null && typeof auth !== 'function') throw new TypeError('auth must be a function or null');

  return async function handle(request) {
    if (!request || typeof request.method !== 'string') {
      return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
    }

    if (typeof auth === 'function') {
      const authorized = await auth(request);
      if (!authorized) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.goal !== 'string' || body.goal.trim() === '') {
      return new Response(JSON.stringify({ error: 'goal_required' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    try {
      const result = await startMission({
        goal: body.goal,
        mission_id: typeof body.mission_id === 'string' ? body.mission_id : null,
        metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
        checkpoint: body.checkpoint && typeof body.checkpoint === 'object' && !Array.isArray(body.checkpoint) ? body.checkpoint : {}
      });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: 'mission_start_failed',
        message: error && error.message ? error.message : 'unknown_error'
      }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }
  };
}

module.exports = Object.freeze({ createMissionHttpHandler });
