'use strict';

// Supabase-independent ARIA adapter for a Windows worker with local Ollama.
// It deliberately exposes a bounded workspace API instead of arbitrary shell execution.
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execFileAsync = promisify(execFile);

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b';
const MAX_MODEL_RESPONSE = 256 * 1024;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 96 * 1024;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.aria-missions', '.aria-backups', '.aria-autonomy-backups', 'supabase', '.ssh', '.config']);
const FORBIDDEN_NAMES = /(^\.env($|\.)|secret|credential|password|token|private.?key|id_rsa|supabase)/i;
const OPERATIONS = new Set(['workspace.list', 'workspace.read', 'workspace.search', 'workspace.write', 'workspace.edit', 'tests.run', 'git.status', 'git.diff']);
const OPERATION_POLICY = Object.freeze({
  'workspace.list': { risk: 'low', idempotent: true },
  'workspace.read': { risk: 'low', idempotent: true },
  'workspace.search': { risk: 'low', idempotent: true },
  'git.status': { risk: 'low', idempotent: true },
  'git.diff': { risk: 'low', idempotent: true },
  'tests.run': { risk: 'low', idempotent: true },
  'workspace.write': { risk: 'medium', idempotent: true },
  'workspace.edit': { risk: 'medium', idempotent: true }
});
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function parseJson(content) {
  if (typeof content !== 'string' || content.length > MAX_MODEL_RESPONSE) throw new Error('ollama_response_invalid');
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('ollama_json_object_missing');
  return JSON.parse(cleaned.slice(first, last + 1));
}

function createOllamaPersistentAdapter({
  workspaceRoot = process.env.ARIA_WORKSPACE_ROOT,
  ollamaUrl = process.env.ARIA_OLLAMA_URL || DEFAULT_OLLAMA_URL,
  model = process.env.ARIA_OLLAMA_MODEL || DEFAULT_MODEL,
  fetchImpl = fetch,
  timeoutMs = 120000
} = {}) {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) throw new TypeError('ARIA_WORKSPACE_ROOT_required');
  const root = path.resolve(workspaceRoot);
  const endpoint = new URL('/api/chat', ollamaUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && endpoint.protocol !== 'https:') {
    throw new Error('remote_ollama_requires_https');
  }

  async function modelJson(system, prompt, numPredict = 2500) {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        options: { temperature: 0.1, num_predict: numPredict }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error('ollama_http_' + response.status);
    const data = await response.json();
    const content = data && data.message && data.message.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('ollama_empty_response');
    return parseJson(content);
  }

  function safeRelativePath(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('workspace_path_required');
    const normalized = value.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) throw new Error('workspace_absolute_path_blocked');
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || FORBIDDEN_NAMES.test(part))) throw new Error('workspace_path_policy_blocked');
    if (parts.some(part => IGNORED_DIRS.has(part.toLowerCase()))) throw new Error('workspace_path_policy_blocked');
    const target = path.resolve(root, ...parts);
    const relative = path.relative(root, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('workspace_path_escape');
    return { target, relative: parts.join(path.sep) };
  }

  async function ensureNoSymlink(target) {
    const relative = path.relative(root, target);
    let current = root;
    const parts = relative.split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) throw new Error('workspace_symlink_blocked');
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('workspace_parent_not_directory');
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
  }

  async function backupExisting(target) {
    let stat;
    try { stat = await fs.stat(target); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile()) throw new Error('workspace_target_must_be_file');
    if (stat.size > MAX_FILE_BYTES) throw new Error('workspace_file_too_large');
    const relative = path.relative(root, target);
    const backupRoot = path.join(root, '.aria-autonomy-backups');
    const backup = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + cryptoSafeName(relative) + '.bak');
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.copyFile(target, backup);
    return path.relative(root, backup);
  }

  function cryptoSafeName(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-180);
  }

  async function atomicWrite(target, content) {
    if (typeof content !== 'string') throw new Error('workspace_content_must_be_text');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('workspace_content_too_large');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await ensureNoSymlink(target);
    const temp = target + '.aria-tmp-' + require('node:crypto').randomUUID();
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, target);
  }

  async function walk(dir, maxDepth = 3, depth = 0, out = []) {
    if (depth > maxDepth || out.length >= 1000) return out;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return out; throw error; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= 1000) break;
      if (entry.name.startsWith('.') && ['.git', '.aria-missions', '.aria-backups', '.aria-autonomy-backups', '.ssh', '.config'].includes(entry.name.toLowerCase())) continue;
      if (IGNORED_DIRS.has(entry.name.toLowerCase()) || FORBIDDEN_NAMES.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        out.push({ path: rel, type: 'directory' });
        if (depth < maxDepth) await walk(full, maxDepth, depth + 1, out);
      } else if (entry.isFile()) {
        out.push({ path: rel, type: 'file' });
      }
    }
    return out;
  }

  async function executeOperation(task) {
    const operation = String(task.operation || '');
    if (!OPERATIONS.has(operation)) throw new Error('workspace_operation_not_supported:' + operation);
    const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload) ? task.payload : {};
    if (operation === 'workspace.list') {
      const rel = payload.path ? safeRelativePath(payload.path) : { target: root, relative: '' };
      await ensureNoSymlink(rel.target);
      const entries = await walk(rel.target, Math.max(0, Math.min(3, Number(payload.depth) || 2)));
      return { passed: true, evidence: { operation, path: rel.relative || '.', entries: entries.slice(0, 300), count: entries.length, truncated: entries.length >= 1000 } };
    }
    if (operation === 'workspace.read') {
      const { target, relative } = safeRelativePath(payload.path);
      await ensureNoSymlink(target);
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('workspace_read_file_type_or_size_rejected');
      const content = await fs.readFile(target, 'utf8');
      return { passed: true, evidence: { operation, path: relative, content: content.slice(0, MAX_OUTPUT_BYTES), truncated: content.length > MAX_OUTPUT_BYTES, bytes: stat.size } };
    }
    if (operation === 'workspace.search') {
      const query = String(payload.query || '').trim();
      if (query.length < 2 || query.length > 300) throw new Error('workspace_search_query_invalid');
      const files = await walk(root, 5);
      const matches = [];
      for (const item of files) {
        if (item.type !== 'file' || matches.length >= 100) continue;
        if (!/\.(js|cjs|mjs|ts|tsx|json|md|yml|yaml|ps1|py|html)$/i.test(item.path)) continue;
        const { target } = safeRelativePath(item.path);
        let content;
        try {
          const stat = await fs.stat(target);
          if (stat.size > 128 * 1024) continue;
          content = await fs.readFile(target, 'utf8');
        } catch (_) { continue; }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < 100; i++) {
          if (lines[i].toLowerCase().includes(query.toLowerCase())) matches.push({ path: item.path, line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
      return { passed: true, evidence: { operation, query, matches, count: matches.length, truncated: matches.length >= 100 } };
    }
    if (operation === 'workspace.write' || operation === 'workspace.edit') {
      const { target, relative } = safeRelativePath(payload.path);
      await ensureNoSymlink(target);
      const existing = await fs.readFile(target, 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      let next;
      if (operation === 'workspace.write') {
        if (typeof payload.content !== 'string') throw new Error('workspace_write_content_required');
        next = payload.content;
      } else {
        if (typeof payload.old_text !== 'string' || !payload.old_text.length || typeof payload.new_text !== 'string') throw new Error('workspace_edit_fields_required');
        if (existing === null) throw new Error('workspace_edit_target_missing');
        const first = existing.indexOf(payload.old_text);
        if (first < 0 || existing.indexOf(payload.old_text, first + payload.old_text.length) >= 0) throw new Error('workspace_edit_match_must_be_unique');
        next = existing.slice(0, first) + payload.new_text + existing.slice(first + payload.old_text.length);
      }
      const backup = await backupExisting(target);
      await atomicWrite(target, next);
      return { passed: true, evidence: { operation, path: relative, backup, bytes_written: Buffer.byteLength(next, 'utf8'), sha256: require('node:crypto').createHash('sha256').update(next).digest('hex') } };
    }
    if (operation === 'tests.run') {
      const testPath = String(payload.test_file || '');
      if (!/^tests\/[A-Za-z0-9._-]+\.test\.js$/.test(testPath.replace(/\\/g, '/'))) throw new Error('test_file_policy_blocked');
      const { target, relative } = safeRelativePath(testPath);
      await ensureNoSymlink(target);
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error('test_file_missing');
      const { stdout = '', stderr = '' } = await execFileAsync(process.execPath, [target], { cwd: root, timeout: Math.max(1000, Math.min(120000, Number(payload.timeout_ms) || 60000)), maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
      return { passed: true, evidence: { operation, test_file: relative, exit_code: 0, stdout: stdout.slice(-20000), stderr: stderr.slice(-10000) } };
    }
    if (operation === 'git.status' || operation === 'git.diff') {
      const args = operation === 'git.status' ? ['status', '--short', '--branch'] : ['diff', '--stat'];
      if (operation === 'git.diff' && payload.path) args.push('--', safeRelativePath(payload.path).relative);
      const { stdout = '', stderr = '' } = await execFileAsync('git', args, { cwd: root, timeout: 15000, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
      return { passed: true, evidence: { operation, output: (stdout + stderr).slice(-MAX_OUTPUT_BYTES) } };
    }
    throw new Error('workspace_operation_not_supported:' + operation);
  }

  async function generateTasks(goal, context = {}, mode = 'plan') {
    if (typeof goal !== 'string' || !goal.trim()) throw new TypeError('goal_required');
    const priorTasks = Array.isArray(context.prior_tasks) ? context.prior_tasks : [];
    const system = [
      'You are ARIA, a cautious autonomous software engineering planner.',
      'Return exactly one JSON object: {"tasks":[...]}. Do not include markdown.',
      'Use only these operations: workspace.list, workspace.read, workspace.search, workspace.write, workspace.edit, tests.run, git.status, git.diff.',
      'Every task must have task_id, title, description, operation, payload, depends_on, idempotent.',
      'payload is an object. workspace.list: {path?,depth?}; workspace.read: {path}; workspace.search: {query}; workspace.write: {path,content}; workspace.edit: {path,old_text,new_text}; tests.run: {test_file,timeout_ms?}; git.status: {}; git.diff: {path?}.',
      'Never read, search, write or edit credentials, .env files, secrets, .git, node_modules, Supabase files, or files outside the workspace.',
      'Do not run arbitrary shell commands, deploy, publish, commit, push, delete, alter credentials, or modify external systems.',
      'Keep plans to 1-6 concrete tasks. Use unique task ids. Dependencies must refer only to earlier tasks in this plan.',
      'Use workspace.read/search/status/diff for inspection. Use workspace.edit for surgical edits and workspace.write for new or fully replaced text files. Run relevant tests after changes.',
      'The worker will enforce operation risk independently of your requested risk labels.'
    ].join('\n');
    const prompt = JSON.stringify({
      mode, goal: goal.trim(), context: { metadata: context.metadata || {}, policy: context.policy || {}, reason: context.reason || null },
      prior_tasks: priorTasks.map(item => ({ task_id: item.task_id, title: item.title, status: item.status, last_error: item.last_error, evidence: item.evidence })).slice(-30),
      workspace_root: path.basename(root),
      output_schema: { tasks: [{ task_id: 'inspect-1', title: 'Inspect repository', description: '...', operation: 'git.status', payload: {}, depends_on: [], idempotent: true }] }
    });
    const data = await modelJson(system, prompt, 3500);
    if (!Array.isArray(data.tasks) || data.tasks.length < 1 || data.tasks.length > 6) throw new Error('ollama_plan_task_count_invalid');
    const ids = new Set();
    return data.tasks.map((task, index) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('ollama_task_invalid');
      const operation = String(task.operation || '');
      if (!OPERATIONS.has(operation)) throw new Error('ollama_operation_rejected:' + operation);
      const taskId = String(task.task_id || ('task-' + (index + 1)));
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(taskId) || ids.has(taskId)) throw new Error('ollama_task_id_invalid');
      const depends = Array.isArray(task.depends_on) ? task.depends_on.map(String) : [];
      if (depends.some(dep => !ids.has(dep))) throw new Error('ollama_task_dependency_invalid');
      ids.add(taskId);
      const payload = task.payload && typeof task.payload === 'object' && !Array.isArray(task.payload) ? task.payload : {};
      const payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (payloadSize > MAX_FILE_BYTES) throw new Error('ollama_task_payload_too_large');
      const policy = OPERATION_POLICY[operation];
      return {
        task_id: taskId, title: String(task.title || operation).slice(0, 200),
        description: String(task.description || '').slice(0, 2000),
        operation, payload, depends_on: depends, risk: policy.risk, irreversible: false,
        idempotent: policy.idempotent, max_attempts: 2
      };
    });
  }

  async function plan(goal, context = {}) {
    return generateTasks(goal, context, 'plan');
  }

  async function replan(mission, context = {}) {
    return generateTasks(mission.goal, {
      metadata: mission.metadata, policy: mission.policy, reason: context.reason || 'replan',
      prior_tasks: mission.tasks
    }, 'replan');
  }

  async function executeTask(task) {
    return executeOperation(task);
  }

  async function verifyCompletion(mission) {
    const unresolved = (mission.tasks || []).filter(task => !['succeeded', 'skipped'].includes(task.status));
    const missingEvidence = (mission.tasks || []).filter(task => task.status === 'succeeded' && (!Array.isArray(task.evidence) || task.evidence.length === 0));
    if (unresolved.length || missingEvidence.length) {
      return { passed: false, reason: 'unresolved_tasks_or_missing_evidence', unresolved: unresolved.map(task => task.task_id), missing_evidence: missingEvidence.map(task => task.task_id) };
    }
    const data = await modelJson(
      'You are ARIA verification. Return JSON only: {"passed":boolean,"reason":string}. Be conservative. The goal is complete only if the supplied execution evidence directly supports it. If evidence is weak or unrelated, passed must be false.',
      JSON.stringify({ goal: mission.goal, tasks: (mission.tasks || []).map(task => ({ task_id: task.task_id, title: task.title, status: task.status, evidence: task.evidence })) }),
      500
    );
    return { passed: data.passed === true, reason: String(data.reason || 'verification_reason_missing'), verifier: 'ollama:' + model, verified_at: new Date().toISOString() };
  }

  return Object.freeze({
    supabaseIndependent: true,
    capabilities: Array.from(OPERATIONS),
    plan, replan, executeTask, verifyCompletion,
    workspaceRoot: root,
    model,
    health: async () => {
      const response = await fetchImpl(new URL('/api/tags', ollamaUrl).toString(), { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('ollama_health_http_' + response.status);
      const data = await response.json();
      const models = Array.isArray(data.models) ? data.models.map(item => item.name) : [];
      return { ok: models.includes(model), model, available_models: models };
    }
  });
}

function createAdapter(options) {
  return createOllamaPersistentAdapter(options);
}

module.exports = Object.freeze({ createOllamaPersistentAdapter, createAdapter, OPERATIONS, OPERATION_POLICY, parseJson });
