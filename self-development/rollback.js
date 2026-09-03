'use strict';

function createSelfRollback({ workspace, snapshotStore = null } = {}) {
  if (!workspace || typeof workspace.restore !== 'function' || !snapshotStore || typeof snapshotStore.load !== 'function') throw new TypeError('rollback_boundary_required');
  return Object.freeze({
    async rollback(paths = []) {
      if (!Array.isArray(paths)) throw new TypeError('paths_required');
      const restored = [];
      for (const path of [...paths].reverse()) {
        const snapshot = await snapshotStore.load(path);
        if (!snapshot) return { status: 'partial', restored, pending: path };
        const result = await workspace.restore(snapshot);
        if (!result || result.status !== 'succeeded') return { status: 'partial', restored, pending: path };
        restored.push(path);
      }
      return { status: 'rolled_back', restored };
    }
  });
}

module.exports = { createSelfRollback };
