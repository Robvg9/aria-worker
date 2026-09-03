'use strict';

function createChangeExecutor({ workspace, snapshotStore = null } = {}) {
  if (!workspace || typeof workspace.apply !== 'function' || typeof workspace.read !== 'function') throw new TypeError('workspace_boundary_required');
  return Object.freeze({
    async apply(plan) {
      if (!plan || !Array.isArray(plan.changes)) throw new TypeError('plan_required');
      const applied = [];
      for (const change of plan.changes) {
        if (change.status !== 'proposed') continue;
        const before = await workspace.read(change.path);
        if (snapshotStore && typeof snapshotStore.save === 'function') await snapshotStore.save({ path: change.path, before });
        const result = await workspace.apply({ ...change });
        if (!result || result.status !== 'succeeded') return { status: 'failed', applied, failed_path: change.path };
        applied.push(change.path);
      }
      return { status: 'succeeded', applied };
    }
  });
}

module.exports = { createChangeExecutor };
