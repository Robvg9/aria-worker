import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const supabase = createClient(
  SUPABASE_URL,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(bytes))
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

async function authenticate(request: Request, deviceId: string) {
  const token = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!token || !deviceId) return false;

  const tokenHash = await hash(token);
  const { data, error } = await supabase
    .schema('aria_internal')
    .from('device_registry')
    .select('device_id,status')
    .eq('device_id', deviceId)
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data || data.status === 'disabled') return false;
  return true;
}

function extractSecretRef(command: unknown) {
  if (typeof command !== 'string') return null;
  let payload: any;
  try { payload = JSON.parse(command); } catch { return null; }

  const ref = payload?.secret_ref;
  if (
    typeof ref !== 'string' ||
    !/^secret:\/\/rwht\/rwht_[A-Za-z0-9._:-]+$/.test(ref)
  ) {
    return null;
  }
  return ref;
}

Deno.serve(async request => {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/v1\/jobs\/([^/]+)\/resolve$/);
    if (request.method !== 'POST' || !match) {
      return json({ error: 'not_found' }, 404);
    }

    const body = await request.json().catch(() => ({}));
    const deviceId = typeof body?.device_id === 'string'
      ? body.device_id.trim()
      : '';

    if (!deviceId || !(await authenticate(request, deviceId))) {
      return json({ error: 'unauthorized' }, 401);
    }

    const jobId = decodeURIComponent(match[1]);
    const { data: job, error: jobError } = await supabase
      .schema('aria_internal')
      .from('execution_jobs')
      .select('job_id,device_id,operation,status,command')
      .eq('job_id', jobId)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (jobError || !job) return json({ error: 'job_not_found' }, 404);

    if (
      job.operation !== 'computer.use.android' ||
      !['claimed', 'running'].includes(String(job.status))
    ) {
      return json({ error: 'secret_resolution_not_allowed' }, 403);
    }

    const secretRef = extractSecretRef(job.command);
    if (!secretRef) return json({ error: 'rwht_secret_ref_required' }, 400);

    const credentialName = secretRef.slice('secret://rwht/'.length);

    const { data: registryEntry, error: registryError } = await supabase
      .schema('aria_internal')
      .from('credential_registry')
      .select('credential_name,status,scope,credential_type')
      .eq('credential_name', credentialName)
      .maybeSingle();

    if (
      registryError ||
      !registryEntry ||
      registryEntry.status !== 'active' ||
      !String(registryEntry.scope || '').toLowerCase().includes('rwht')
    ) {
      return json({ error: 'credential_not_registered' }, 409);
    }

    const { data: secret, error: secretError } = await supabase.rpc(
      'read_aria_credential_secret',
      { p_name: credentialName }
    );

    if (secretError || typeof secret !== 'string' || secret.length === 0) {
      return json({ error: 'credential_unavailable' }, 409);
    }

    return json({
      ok: true,
      secret_ref: secretRef,
      secret
    });
  } catch {
    return json({ error: 'secret_resolution_failed' }, 500);
  }
});
