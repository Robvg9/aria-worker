'use strict';

function createScheduler({ now = () => Date.now() } = {}) {
  const jobs = new Map();
  return {
    schedule(job) {
      if (!job || typeof job.id !== 'string' || typeof job.run !== 'function') throw new Error('invalid job');
      const dueAt = Number.isFinite(job.due_at) ? job.due_at : now();
      jobs.set(job.id, { ...job, due_at: dueAt, active: true });
      return jobs.get(job.id);
    },
    cancel(id) { const j = jobs.get(id); if (j) j.active = false; return Boolean(j); },
    due(at = now()) { return [...jobs.values()].filter(j => j.active && j.due_at <= at).sort((a,b) => a.due_at-b.due_at || a.id.localeCompare(b.id)); },
    snapshot() { return [...jobs.values()].map(({ run, ...j }) => ({ ...j })); }
  };
}

module.exports = { createScheduler };
