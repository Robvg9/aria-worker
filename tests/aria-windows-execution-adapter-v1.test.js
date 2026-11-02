'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAriaWindowsExecutionAdapter,
  OPERATIONS
} = require('../autonomy/aria-windows-execution-adapter-v1');

(async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-windows-execution-only-'));
  try {
    const adapter = createAriaWindowsExecutionAdapter({ workspaceRoot });
    assert.equal(adapter.supabaseIndependent, true);
    assert.equal(adapter.localInference, false);
    assert.equal(typeof adapter.plan, 'undefined', 'Windows execution adapter must not plan or call a model');
    assert.equal(typeof adapter.replan, 'undefined', 'Windows execution adapter must not replan or call a model');
    assert.equal(typeof adapter.executeTask, 'function');
    assert.equal(typeof adapter.verifyCompletion, 'function');
    assert.equal((await adapter.health()).ok, true);
    assert.equal((await adapter.health()).local_inference, false);
    assert.ok(OPERATIONS.has('workspace.write'));

    const write = await adapter.executeTask({
      operation: 'workspace.write',
      payload: { path: 'notes/result.txt', content: 'execution-only proof\n' }
    });
    assert.equal(write.passed, true);
    assert.match(write.evidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, 'notes', 'result.txt'), 'utf8'),
      'execution-only proof\n'
    );

    const read = await adapter.executeTask({
      operation: 'workspace.read',
      payload: { path: 'notes/result.txt' }
    });
    assert.equal(read.passed, true);
    assert.equal(read.evidence.content, 'execution-only proof\n');

    const editTask = {
      operation: 'workspace.edit',
      payload: { path: 'notes/result.txt', old_text: 'execution-only', new_text: 'remote-plan' }
    };
    const edited = await adapter.executeTask(editTask);
    assert.equal(edited.passed, true);
    assert.ok(edited.evidence.backup);
    const retried = await adapter.executeTask(editTask);
    assert.equal(retried.passed, true);
    assert.equal(retried.evidence.already_applied, true);

    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: '../outside.txt' } }),
      /workspace_path_policy_blocked|workspace_absolute_path_blocked|workspace_path_escape/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: '.env' } }),
      /workspace_path_policy_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'workspace.read', payload: { path: 'supabase/config.toml' } }),
      /workspace_path_policy_blocked/
    );
    await assert.rejects(
      () => adapter.executeTask({ operation: 'shell.execute', payload: { command: 'whoami' } }),
      /workspace_operation_not_supported/
    );

    const incomplete = await adapter.verifyCompletion({
      tasks: [{ task_id: 'missing', status: 'succeeded', evidence: [] }]
    });
    assert.equal(incomplete.passed, false);

    const verified = await adapter.verifyCompletion({
      tasks: [{
        task_id: 'edit-note',
        operation: 'workspace.edit',
        status: 'succeeded',
        evidence: [edited.evidence]
      }]
    });
    assert.equal(verified.passed, true);
    assert.equal(verified.verifier, 'local-execution-evidence-v1');

    const forged = await adapter.verifyCompletion({
      tasks: [{
        task_id: 'forged-write',
        operation: 'workspace.write',
        status: 'succeeded',
        evidence: [{ path: 'notes/result.txt', sha256: '0'.repeat(64) }]
      }]
    });
    assert.equal(forged.passed, false);
    assert.deepEqual(forged.invalid_evidence, ['forged-write']);

    process.stdout.write('aria-windows-execution-adapter-v1: PASS; local inference disabled\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
