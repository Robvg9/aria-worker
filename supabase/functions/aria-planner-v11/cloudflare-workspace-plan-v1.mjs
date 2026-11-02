'use strict';

const PRODUCER_HEADER = 'x-aria-plan-producer';
const PRODUCER_TOKEN_HEADER = 'x-aria-plan-producer-token';
const PRODUCER_KIND = 'cloudflare-workspace-v1';
const DERIVATION_LABEL = 'aria-cloudflare-plan-producer:v1';
const OPERATIONS = new Set([
  'workspace.list',
  'workspace.read',
  'workspace.search',
  'workspace.write',
  'workspace.edit',
  'tests.run',
  'git.status',
  'git.diff'
]);
const MAX_TASKS = 6;
const MAX_FILE_BYTES = 512 * 1024;
const FORBIDDEN_SEGMENTS = new Set([
  '.git', 'node_modules', '.aria-missions', '.aria-backups',
  '.aria-autonomy-backups', 'supabase', '.ssh', '.config'
]);
const FORBIDDEN_NAMES = /(^\.env($|\.)|secret|credential|password|token|private.?key|id_rsa|supabase)/i;
const encoder = new TextEncoder();

function safeRelativePath(value, field = 'path') {
  if (typeof value !== 'string' || !value.trim()) throw new Error('workspace_' + field + '_required');
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    throw new Error('workspace_absolute_path_blocked');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..' || FORBIDDEN_NAMES.test(part))) {
    throw new Error('workspace_path_policy_blocked');
  }
  if (parts.some(part => FORBIDDEN_SEGMENTS.has(part.toLowerCase()))) {
    throw new Error('workspace_path_policy_blocked');
  }
  return parts.join('/');
}

function boundedText(value, field, maxBytes, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length)) {
    throw new Error(field + '_required');
  }
  if (encoder.encode(value).length > maxBytes) throw new Error(field + '_too_large');
  return value;
}

function normalizeTask(raw, index, knownIds, allowMutations) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plan_task_invalid');
  const taskId = String(raw.task_id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId) || knownIds.has(taskId)) {
    throw new Error('plan_task_id_invalid');
  }
  const operation = String(raw.operation || '');
  if (!OPERATIONS.has(operation)) throw new Error('plan_operation_rejected');
  const rawPayload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
    ? raw.payload
    : {};
  const payload = {};

  if (operation === 'workspace.list') {
    if (rawPayload.path) payload.path = safeRelativePath(rawPayload.path);
    payload.depth = Math.max(0, Math.min(3, Number(rawPayload.depth ?? 2)));
    if (!Number.isFinite(payload.depth)) throw new Error('workspace_list_depth_invalid');
  } else if (operation === 'workspace.read') {
    payload.path = safeRelativePath(rawPayload.path);
  } else if (operation === 'workspace.search') {
    const query = String(rawPayload.query || '').trim();
    if (query.length < 2 || query.length > 300) throw new Error('workspace_search_query_invalid');
    payload.query = query;
  } else if (operation === 'workspace.write') {
    if (allowMutations !== true) throw new Error('workspace_mutations_not_explicitly_allowed');
    payload.path = safeRelativePath(rawPayload.path);
    payload.content = boundedText(rawPayload.content, 'workspace_write_content', MAX_FILE_BYTES, { allowEmpty: true });
  } else if (operation === 'workspace.edit') {
    if (allowMutations !== true) throw new Error('workspace_mutations_not_explicitly_allowed');
    payload.path = safeRelativePath(rawPayload.path);
    payload.old_text = boundedText(rawPayload.old_text, 'workspace_edit_old_text', 32 * 1024);
    payload.new_text = boundedText(rawPayload.new_text, 'workspace_edit_new_text', MAX_FILE_BYTES, { allowEmpty: true });
  } else if (operation === 'tests.run') {
    const testFile = String(rawPayload.test_file || '').replace(/\\/g, '/');
    if (!/^tests\/[A-Za-z0-9._-]+\.test\.js$/.test(testFile)) throw new Error('test_file_policy_blocked');
    payload.test_file = safeRelativePath(testFile, 'test_file');
    payload.timeout_ms = Math.max(1000, Math.min(120000, Number(rawPayload.timeout_ms) || 60000));
  } else if (operation === 'git.diff' && rawPayload.path) {
    payload.path = safeRelativePath(rawPayload.path);
  }

  const dependsOn = Array.isArray(raw.depends_on) ? raw.depends_on.map(String) : [];
  if (dependsOn.some(dep => !knownIds.has(dep))) throw new Error('plan_dependency_invalid');
  if (dependsOn.length > MAX_TASKS) throw new Error('plan_dependency_count_invalid');
  const payloadBytes = encoder.encode(JSON.stringify(payload)).length;
  if (payloadBytes > MAX_FILE_BYTES + 64 * 1024) throw new Error('plan_payload_too_large');

  return {
    task_id: taskId,
    title: String(raw.title || operation).slice(0, 200),
    description: String(raw.description || '').slice(0, 2000),
    operation,
    payload,
    depends_on: dependsOn,
    idempotent: raw.idempotent !== false,
    max_attempts: Math.max(1, Math.min(3, Number(raw.max_attempts) || 2))
  };
}

export function buildCloudflareWorkspacePlan(goal, request) {
  const normalizedGoal = boundedText(goal, 'goal', 10000);
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.version !== 'v1') {
    throw new Error('cloudflare_workspace_request_v1_required');
  }
  if (!Array.isArray(request.tasks) || request.tasks.length < 1 || request.tasks.length > MAX_TASKS) {
    throw new Error('plan_task_count_invalid');
  }
  const allowMutations = request.allow_mutations === true;
  const knownIds = new Set();
  const tasks = [];
  for (let index = 0; index < request.tasks.length; index += 1) {
    const task = normalizeTask(request.tasks[index], index, knownIds, allowMutations);
    knownIds.add(task.task_id);
    tasks.push(task);
  }
  return Object.freeze({
    goal: normalizedGoal,
    tasks: Object.freeze(tasks),
    planner_version: 'aria-planner-v11-cloudflare-workspace-v1',
    contract_version: 'cloudflare-workspace-v1',
    requires_human_approval_for_mutations: tasks.some(task =>
      task.operation === 'workspace.write' || task.operation === 'workspace.edit')
  });
}

export async function deriveCloudflarePlanProducerToken(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('aria_runtime_shared_secret_invalid');
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(DERIVATION_LABEL));
  return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function isCloudflarePlanProducerRequest(request, sharedSecret) {
  if (!(request instanceof Request) || request.method !== 'POST') return false;
  if (request.headers.get(PRODUCER_HEADER) !== PRODUCER_KIND) return false;
  const supplied = request.headers.get(PRODUCER_TOKEN_HEADER) || '';
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  let expected;
  try { expected = await deriveCloudflarePlanProducerToken(sharedSecret); }
  catch (_) { return false; }
  return constantTimeEqual(supplied, expected);
}

export const CLOUDflarePlanProducerContract = Object.freeze({
  producerHeader: PRODUCER_HEADER,
  producerTokenHeader: PRODUCER_TOKEN_HEADER,
  producerKind: PRODUCER_KIND,
  derivationLabel: DERIVATION_LABEL,
  allowedOperations: Object.freeze(Array.from(OPERATIONS))
});
