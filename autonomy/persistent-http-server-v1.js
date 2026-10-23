'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPollingSupervisor } = require('./persistent-control-plane-v1');

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function readJson(req, limit = 65536) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) throw Object.assign(new Error('request_too_large'), { statusCode: 413 });
  }
  try { return JSON.parse(raw || '{}'); }
  catch (_) { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }); }
}

function createPersistentHttpServer({
  store,
  autonomy,
  token = process.env.ARIA_CONTROL_TOKEN,
  host = process.env.ARIA_CONTROL_HOST || '127.0.0.1',
  port = Number(process.env.ARIA_CONTROL_PORT || 8787),
  runSupervisor = true,
  notify = async () => {},
  dashboardPath = path.join(__dirname, 'persistent-dashboard-v1.html'),
  supervisorIntervalMs = 3000
} = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.list !== 'function') throw new TypeError('store_required');
  if (!autonomy || typeof autonomy.start !== 'function' || typeof autonomy.tick !== 'function' || typeof autonomy.resume !== 'function') throw new TypeError('autonomy_runtime_required');
  if (typeof token !== 'string' || token.length < 32) throw new Error('ARIA_CONTROL_TOKEN must contain at least 32 characters');
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    if (process.env.ARIA_ALLOW_REMOTE_BIND !== 'true' || process.env.ARIA_CONTROL_HTTPS_TERMINATED !== 'true') {
      throw new Error('remote_bind_requires_ARIA_ALLOW_REMOTE_BIND=true_and_ARIA_CONTROL_HTTPS_TERMINATED=true');
    }
  }

  const supervisor = createPollingSupervisor({
    listMissions: () => store.list(),
    tickMission: missionId => autonomy.tick(missionId),
    intervalMs: supervisorIntervalMs,
    onError: async event => {
      await notify({ type: 'supervisor_error', ...event });
    }
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, service: 'aria-persistent-autonomy-v1', supabase_independent: true });
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await fs.readFile(dashboardPath);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-length': html.length
        });
        return res.end(html);
      }

      const authorization = String(req.headers.authorization || '');
      const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!sameSecret(bearer, token)) return json(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/api/missions') {
        const missions = await store.list();
        return json(res, 200, { missions });
      }
      if (req.method === 'POST' && url.pathname === '/api/missions') {
        const body = await readJson(req);
        if (typeof body.goal !== 'string' || !body.goal.trim()) return json(res, 400, { error: 'goal_required' });
        const mission = await autonomy.start({
          goal: body.goal,
          metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {},
          policy: body.policy && typeof body.policy === 'object' && !Array.isArray(body.policy) ? body.policy : {}
        });
        return json(res, 201, { mission });
      }

      let match = url.pathname.match(/^\/api\/missions\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'GET' && match) {
        const mission = await store.get(match[1]);
        return mission ? json(res, 200, { mission }) : json(res, 404, { error: 'mission_not_found' });
      }
      match = url.pathname.match(/^\/api\/missions\/([a-zA-Z0-9_-]+)\/events$/);
      if (req.method === 'GET' && match) {
        if (!await store.get(match[1])) return json(res, 404, { error: 'mission_not_found' });
        return json(res, 200, { events: await store.events(match[1]) });
      }
      match = url.pathname.match(/^\/api\/missions\/([a-zA-Z0-9_-]+)\/resume$/);
      if (req.method === 'POST' && match) {
        const mission = await autonomy.resume(match[1]);
        return json(res, 200, { mission });
      }
      match = url.pathname.match(/^\/api\/approvals\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'POST' && match) {
        const body = await readJson(req);
        if (!['approved', 'rejected'].includes(body.decision)) return json(res, 400, { error: 'decision_must_be_approved_or_rejected' });
        const approval = await store.resolveApproval(match[1], body.decision, 'dashboard-operator');
        if (body.decision === 'approved') await autonomy.resume(approval.mission_id);
        return json(res, 200, { approval, mission: await store.get(approval.mission_id) });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      const status = Number(error && error.statusCode) || 500;
      return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
    }
  });

  let supervisorPromise = null;
  return Object.freeze({
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
      });
      if (runSupervisor) {
        supervisorPromise = supervisor.run();
        supervisorPromise.catch(async error => notify({ type: 'supervisor_fatal', error: String(error && error.message || error) }));
      }
      return { host, port: server.address().port };
    },
    async close() {
      supervisor.stop();
      await new Promise(resolve => server.close(() => resolve()));
      if (supervisorPromise) await Promise.race([supervisorPromise, new Promise(resolve => setTimeout(resolve, 1000))]);
    }
  });
}

module.exports = Object.freeze({ createPersistentHttpServer });
