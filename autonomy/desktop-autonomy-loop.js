'use strict';

const VERSION = 'aria-desktop-autonomy-v1';

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function createDesktopAutonomyLoop({
  readVision,
  deriveMission,
  runMission,
  reflect = async input => ({ status: 'recorded', input }),
  interval_ms = 60_000,
  max_missions_per_tick = 1,
  enabled = true,
  now = () => new Date()
} = {}) {
  requireFn(readVision, 'readVision');
  requireFn(deriveMission, 'deriveMission');
  requireFn(runMission, 'runMission');
  requireFn(reflect, 'reflect');

  if (!Number.isInteger(interval_ms) || interval_ms < 10_000) throw new TypeError('interval_ms must be at least 10000');
  if (!Number.isInteger(max_missions_per_tick) || max_missions_per_tick < 1 || max_missions_per_tick > 10) throw new TypeError('max_missions_per_tick must be between 1 and 10');

  let timer = null;
  let running = false;
  let stopped = !enabled;
  let tickCount = 0;

  async function tick(reason = 'scheduled') {
    if (stopped || running) return { status: 'skipped', reason: stopped ? 'disabled' : 'busy' };
    running = true;
    tickCount += 1;
    const startedAt = now().toISOString();
    try {
      const vision = await readVision({ reason, tick: tickCount });
      if (!vision || typeof vision !== 'object') return { status: 'blocked', reason: 'vision_invalid', tick: tickCount };
      const derived = await deriveMission({ vision, tick: tickCount });
      const missions = Array.isArray(derived) ? derived : (derived ? [derived] : []);
      const results = [];
      for (const mission of missions.slice(0, max_missions_per_tick)) {
        if (!mission || typeof mission !== 'object') continue;
        const result = await runMission({ mission, vision, tick: tickCount });
        results.push(result && typeof result === 'object' ? result : { status: 'failed', value: result });
      }
      const reflection = await reflect({ vision, missions, results, tick: tickCount, started_at: startedAt });
      return Object.freeze({ status: 'completed', version: VERSION, tick: tickCount, started_at: startedAt, missions: results, reflection });
    } catch (error) {
      return Object.freeze({ status: 'failed', version: VERSION, tick: tickCount, started_at: startedAt, error: String(error?.message || error) });
    } finally {
      running = false;
    }
  }

  function start() {
    if (stopped === false && timer) return { status: 'already_running' };
    stopped = false;
    timer = setInterval(() => { void tick('scheduled'); }, interval_ms);
    void tick('startup');
    return { status: 'started', version: VERSION, interval_ms };
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    return { status: 'stopped', version: VERSION };
  }

  function status() {
    return Object.freeze({ version: VERSION, enabled: !stopped, running, tick_count: tickCount, interval_ms });
  }

  return Object.freeze({ version: VERSION, tick, start, stop, status });
}

module.exports = Object.freeze({ VERSION, createDesktopAutonomyLoop });
