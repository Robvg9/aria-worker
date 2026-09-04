import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const MAX_OUTPUT = 256 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function tokenHash(token: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(bytes =>
    Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('')
  );
}
function bounded(value: unknown) {
  const text = typeof value === 'string' ? value : '';
  return text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text;
}
function sanitize(value: unknown) {
  let text = bounded(value);
  const patterns = [ /Bearer\s+[A-Za-z0-9._\-]+/g, /\bsk-[A-Za-z0-9_\-]{8,}/g, /\bor-v1-[A-Za-z0-9_\-]{8,}/g, /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi ];
  for (const pattern of patterns) text = text.replace(pattern, '[redacted]');
  return text;
}
async function authenticate(req: Request, suppliedDeviceId?: string) {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: json({ error: 'unauthorized' }, 401) };
  const deviceId = suppliedDeviceId || req.headers.get('x-aria-device-id');
  if (!deviceId) return { error: json({ error: 'device_id_required' }, 400) };
  const hash = await tokenHash(match[1]);
  const { data, error } = await supabase.from('device_registry').select('device_id,agent_type,status,capabilities').eq('device_id', deviceId).eq('token_hash', hash).maybeSingle();
  if (error || !data) return { error: json({ error: 'unauthorized' }, 401) };
  if (data.status === 'disabled') return { error: json({ error: 'device_disabled' }, 403) };
  return { device: data };
}
async function body(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/aria-device-gateway/, '').replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/health') return json({ ok: true, service: 'aria-device-gateway', version: '1' });

  const payload = await body(req);
  const auth = await authenticate(req, payload.device_id);
  if (auth.error) return auth.error;
  const device = auth.device!;

  if (req.method === 'POST' && path === '/v1/devices/heartbeat') {
    const { error } = await supabase.from('device_registry').update({
      status: 'online',
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : device.capabilities,
      metadata: { agent_type: payload.agent_type || device.agent_type },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('device_id', device.device_id);
    if (error) return json({ error: 'heartbeat_failed' }, 500);
    return json({ ok: true, device_id: device.device_id });
  }

  if (req.method === 'POST' && path === '/v1/jobs/claim') {
    const { data, error } = await supabase.rpc('claim_execution_job', { p_device_id: device.device_id });
    if (error) return json({ error: 'claim_failed' }, 500);
    const job = Array.isArray(data) ? data[0] ?? null : data ?? null;
    return json({ job });
  }

  const start = path.match(/^\/v1\/jobs\/([^/]+)\/start$/);
  if (req.method === 'POST' && start) {
    const jobId = decodeURIComponent(start[1]);
    const { data, error } = await supabase.from('execution_jobs').update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('job_id', jobId).eq('device_id', device.device_id).eq('status', 'claimed').select('job_id,device_id,status').maybeSingle();
    if (error) return json({ error: 'start_failed' }, 500);
    if (!data) return json({ error: 'job_not_owned_or_not_claimed' }, 409);
    return json({ ok: true, job: data });
  }

  const result = path.match(/^\/v1\/jobs\/([^/]+)\/result$/);
  if (req.method === 'POST' && result) {
    const jobId = decodeURIComponent(result[1]);
    if (!payload.result || typeof payload.result !== 'object') return json({ error: 'result_required' }, 400);
    const r = payload.result as Record<string, unknown>;
    const status = ['succeeded','failed','timeout','cancelled'].includes(String(r.status)) ? String(r.status) : 'failed';
    const exitCode = Number.isInteger(r.exit_code) ? r.exit_code : null;
    const cleanResult = {
      status,
      exit_code: exitCode,
      stdout: sanitize(r.stdout),
      stderr: sanitize(r.stderr),
      duration_ms: Number.isFinite(Number(r.duration_ms)) ? Number(r.duration_ms) : null,
      metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {}
    };
    const { data, error } = await supabase.from('execution_jobs').update({
      status,
      exit_code: exitCode,
      stdout: cleanResult.stdout,
      stderr: cleanResult.stderr,
      result: cleanResult,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('job_id', jobId).eq('device_id', device.device_id).in('status', ['running','claimed']).select('job_id,status').maybeSingle();
    if (error) return json({ error: 'result_failed' }, 500);
    if (!data) return json({ error: 'job_not_owned_or_already_finished' }, 409);
    await supabase.from('execution_job_events').insert({ job_id: jobId, device_id: device.device_id, event_type: `job.${status}`, payload: { exit_code: exitCode, duration_ms: cleanResult.duration_ms } });
    return json({ ok: true, job: data });
  }

  return json({ error: 'not_found' }, 404);
});
