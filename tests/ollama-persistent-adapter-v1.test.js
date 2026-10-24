'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOllamaPersistentAdapter } = require('../autonomy/ollama-persistent-adapter-v1');
const { loadAdapter } = require('../scripts/aria-persistent-autonomy-v1');

async function tryCreateSymlink(target, linkPath) {
  try {
    await fs.symlink(target, linkPath, 'dir');
    return true;
  } catch (error) {
    // Windows may disallow symlink creation when Developer Mode or privileges are unavailable.
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error && error.code)) return false;
    throw error;
  }
}

(async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-ollama-adapter-v1-'));
  try {
    await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# ARIA workspace\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'SECRET=must-not-enter-model-context\n', 'utf8');
    let planningPrompt = null;
    const fetchImpl = async (url, options = {}) => {
      if (String(url).includes('/api/tags')) {
        return { ok: true, json: async () => ({ models: [{ name: 'qwen3:4b' }] }) };
      }
      const request = JSON.parse(options.body);
      planningPrompt = request.messages[1].content;
      const system = request.messages[0].content;
      const content = /verification/i.test(system)
        ? JSON.stringify({ passed: true, reason: 'All requested file evidence is present.' })
        : JSON.stringify({
            tasks: [{
              task_id: 'write-note',
              title: 'Write a note',
              description: 'Create a small test artifact',
              operation: 'workspace.write',
              payload: { path: 'notes/result.txt', content: 'first version' },
              depends_on: [],
              idempotent: true,
              risk: 'low'
            }]
          });
      return { ok: true, status: 200, json: async () => ({ message: { content } }) };
    };
    const adapter = createOllamaPersistentAdapter({ workspaceRoot, fetchImpl });
    assert.equal((await adapter.health()).ok, true);

    const factoryAdapter = loadAdapter(path.join(__dirname, '..', 'autonomy', 'ollama-persistent-adapter-v1.js'), { ARIA_WORKSPACE_ROOT: workspaceRoot });
    assert.equal(factoryAdapter.supabaseIndependent, true);
    assert.equal(typeof factoryAdapter.plan, 'function');
    assert.equal(typeof factoryAdapter.executeTask, 'function');
    assert.equal(typeof factoryAdapter.verifyCompletion, 'function');

    const tasks = await adapter.plan('Create a small note for the test');
    const parsedPrompt = JSON.parse(planningPrompt);
    assert.ok(parsedPrompt.workspace_files.includes('README.md'));
    assert.equal(parsedPrompt.workspace_files.some(file => file.toLowerCase().includes('.env')), false);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].operation, 'workspace.write');
    assert.equal(tasks[0].risk, 'medium');

    const written = await adapter.executeTask(tasks[0]);
    assert.equal(written.passed, true);
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'notes', 'result.txt'), 'utf8'), 'first version');

    const editTask = {
      operation: 'workspace.edit',
      payload: { path: 'notes/result.txt', old_text: 'first version', new_text: 'second version' }
    };
    const edited = await adapter.executeTask(editTask);
    assert.equal(edited.passed, true);
    assert.ok(edited.evidence.backup);
    const retriedEdit = await adapter.executeTask(editTask);
    assert.equal(retriedEdit.passed, true);
    assert.equal(retriedEdit.evidence.already_applied, true);

    const read = await adapter.executeTask({ operation: 'workspace.read', payload: { path: 'notes/result.txt' } });
    assert.equal(read.evidence.content, 'second version');
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: '../outside.txt' } }),
      /workspace_path_policy_blocked|workspace_absolute_path_blocked|workspace_path_escape/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: '.env' } }),
      /workspace_path_policy_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: 'credentials.json' } }),
      /workspace_path_policy_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: 'supabase/config.toml' } }),
      /workspace_path_policy_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: path.resolve(workspaceRoot, 'README.md') } }),
      /workspace_absolute_path_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'powershell.execute', payload: { command: 'echo unsafe' } }),
      /workspace_operation_not_supported/
    );

    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-ollama-outside-v1-'));
    try {
      await fs.writeFile(path.join(outsideRoot, 'outside-data.txt'), 'outside-workspace-data', 'utf8');
      const symlinkAvailable = await tryCreateSymlink(outsideRoot, path.join(workspaceRoot, 'linked-outside'));
      if (symlinkAvailable) {
        await assert.rejects(
          () => adapter.executeTask({ operation: 'workspace.read', payload: { path: 'linked-outside/outside-data.txt' } }),
          /workspace_symlink_blocked/
        );
        const listed = await adapter.executeTask({ operation: 'workspace.list', payload: { depth: 3 } });
        assert.equal(listed.evidence.entries.some(entry => entry.path.startsWith('linked-outside')), false, 'workspace listing must not follow symlinks');
      }
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }

    const symlinkRoot = path.join(os.tmpdir(), 'aria-ollama-root-link-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    const rootSymlinkAvailable = await tryCreateSymlink(workspaceRoot, symlinkRoot);
    if (rootSymlinkAvailable) {
      try {
        const linkedRootAdapter = createOllamaPersistentAdapter({ workspaceRoot: symlinkRoot, fetchImpl });
        await assert.rejects(
          () => linkedRootAdapter.executeTask({ operation: 'workspace.read', payload: { path: 'README.md' } }),
          /workspace_root_invalid/
        );
      } finally {
        await fs.rm(symlinkRoot, { force: true });
      }
    }

    assert.throws(
      () => createOllamaPersistentAdapter({ workspaceRoot, ollamaUrl: 'http://192.0.2.10:11434', fetchImpl }),
      /remote_ollama_requires_https/
    );

    const verification = await adapter.verifyCompletion({
      goal: 'Create and update the note',
      tasks: [{ task_id: 'write-note', title: 'Write a note', status: 'succeeded', evidence: [{ operation: 'workspace.write', path: 'notes/result.txt' }] }]
    });
    assert.equal(verification.passed, true);
    process.stdout.write('ollama-persistent-adapter-v1: all tests passed\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
