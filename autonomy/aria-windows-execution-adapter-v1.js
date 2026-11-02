'use strict';

// Execution-only Windows adapter. It performs bounded local workspace operations.
// Planning and semantic reasoning are remote responsibilities; this module never
// loads a model, opens an AI endpoint, or consumes local CPU/RAM for inference.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execFileAsync = promisify(execFile);

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

function createAriaWindowsExecutionAdapter({ workspaceRoot = process.env.ARIA_WORKSPACE_ROOT } = {}) {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) throw new TypeError('ARIA_WORKSPACE_ROOT_required');
  const root = path.resolve(workspaceRoot);

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
    const rootStat = await fs.lstat(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('workspace_root_invalid');
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
    const backup = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID() + '-' + cryptoSafeName(relative) + '.bak');
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.copyFile(target, backup);
    return path.relative(root, backup);
  }

  function cryptoSafeName(value) {
    return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-180);
  }

  async function atomicWrite(target, content) {
    await ensureNoSymlink(target);
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
      const files = (await walk(root, 4))
        .filter(item => item.type === 'file' && /\.(js|cjs|mjs|ts|tsx|json|md|yml|yaml|ps1|py|html)$/i.test(item.path))
        .sort((a, b) => Number(b.path.toLowerCase().includes(query.toLowerCase())) - Number(a.path.toLowerCase().includes(query.toLowerCase())))
        .slice(0, 250);
      const matches = [];
      for (const item of files) {
        if (matches.length >= 50) break;
        const { target } = safeRelativePath(item.path);
        let content;
        try {
          const stat = await fs.stat(target);
          if (stat.size > 64 * 1024) continue;
          content = await fs.readFile(target, 'utf8');
        } catch (_) { continue; }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < 50; i++) {
          if (lines[i].toLowerCase().includes(query.toLowerCase())) matches.push({ path: item.path, line: i + 1, text: lines[i].slice(0, 400) });
        }
      }
      return { passed: true, evidence: { operation, query, matches, count: matches.length, scanned_files: files.length, truncated: matches.length >= 50 || files.length >= 250 } };
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
        if (first < 0) {
          if (payload.new_text.length && existing.indexOf(payload.new_text) >= 0 && existing.indexOf(payload.new_text, existing.indexOf(payload.new_text) + payload.new_text.length) < 0) {
            return { passed: true, evidence: { operation, path: relative, already_applied: true, sha256: crypto.createHash('sha256').update(existing).digest('hex') } };
          }
          throw new Error('workspace_edit_match_missing');
        }
        if (existing.indexOf(payload.old_text, first + payload.old_text.length) >= 0) throw new Error('workspace_edit_match_must_be_unique');
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

  async function executeTask(task) {
    return executeOperation(task);
  }

  async function verifyCompletion(mission) {
    const tasks = Array.isArray(mission && mission.tasks) ? mission.tasks : [];
    const unresolved = tasks.filter(task => !['succeeded', 'skipped'].includes(task.status));
    const missingEvidence = tasks.filter(task => task.status === 'succeeded' &&
      (!Array.isArray(task.evidence) || task.evidence.length === 0));
    if (!tasks.length || unresolved.length || missingEvidence.length) {
      return {
        passed: false,
        reason: 'unresolved_tasks_or_missing_evidence',
        unresolved: unresolved.map(task => task.task_id),
        missing_evidence: missingEvidence.map(task => task.task_id)
      };
    }
    return {
      passed: true,
      reason: 'all_tasks_terminal_with_execution_evidence',
      verifier: 'local-execution-evidence-v1',
      verified_at: new Date().toISOString()
    };
  }

  async function health() {
    const stat = await fs.stat(root);
    const ok = stat.isDirectory();
    return { ok, workspace_ready: ok, local_inference: false, adapter: 'aria-windows-execution-v1' };
  }

  return Object.freeze({
    supabaseIndependent: true,
    localInference: false,
    capabilities: Object.freeze([...OPERATIONS, 'mission.verify']),
    workspaceRoot: root,
    health,
    executeTask,
    verifyCompletion
  });
}

function createAdapter(options) {
  return createAriaWindowsExecutionAdapter(options);
}

module.exports = Object.freeze({
  createAriaWindowsExecutionAdapter,
  createAdapter,
  OPERATIONS,
  OPERATION_POLICY
});
