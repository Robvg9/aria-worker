'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const VERSION = 'aria-meditation-ia-v1';
const MODES = Object.freeze(['standby', 'active', 'paused', 'stopped']);
const COMMANDS = Object.freeze(['START', 'AVANZA', 'CONTINUA', 'PAUSA', 'CERRAR', 'DETENER', 'ESTADO']);

function fingerprintMission(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value || {});
  return raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
}

function defaultState() {
  return {
    version: VERSION, mode: 'standby', session_id: null, tick_count: 0, active_mission_id: null,
    active_goal: null, started_at: null, paused_at: null, stopped_at: null, last_tick_at: null,
    last_result: null, last_error: null, last_checkpoint: null, failure_ledger: {}, command_offset: 0
  };
}

function meditationProcessMatch(pid) {
  try {
    const script = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${Number(pid)}\" -ErrorAction SilentlyContinue; if($p){$p.CommandLine}`;
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 3000 }).trim();
    if (!output) return false;
    return /aria-meditation-controller\.js/i.test(output);
  } catch { return null; }
}

function createFileStateStore({ root_dir } = {}) {
  if (!root_dir) throw new TypeError('root_dir required');
  const root = path.resolve(root_dir);
  const statePath = path.join(root, 'state.json');
  const lockPath = path.join(root, 'controller.lock');
  const agentPidPath = path.resolve(root, '..', '..', 'Logs', 'agent.pid');
  let saveQueue = Promise.resolve();

  async function ensureRoot() { await fsp.mkdir(root, { recursive: true }); }

  async function load() {
    await ensureRoot();
    try { return { ...defaultState(), ...JSON.parse(await fsp.readFile(statePath, 'utf8')) }; }
    catch {
      const state = defaultState();
      await save(state);
      return state;
    }
  }

  async function save(state) {
    await ensureRoot();
    const run = async () => {
      const tmp = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      let lastError = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await fsp.rename(tmp, statePath);
          return state;
        } catch (error) {
          lastError = error;
          if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      try {
        await fsp.rm(statePath, { force: true });
        await fsp.rename(tmp, statePath);
        return state;
      } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw lastError || error;
      }
    };
    const task = saveQueue.then(run, run);
    saveQueue = task.catch(() => {});
    return task;
  }

  async function currentAgentPid() {
    try {
      const value = Number((await fsp.readFile(agentPidPath, 'utf8')).trim());
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch { return null; }
  }

  async function writeLock(extra = {}) {
    const handle = await fsp.open(lockPath, 'wx');
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString(), ...extra }), 'utf8'); }
    finally { await handle.close(); }
  }

  async function reclaimLock(reason, previous = {}) {
    await fsp.rm(lockPath, { force: true });
    await writeLock({ reclaimed: true, reason, ...previous });
    return true;
  }

  async function acquireLock() {
    await ensureRoot();
    try { await writeLock(); return true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    try {
      const old = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
      const oldPid = Number(old?.pid);
      if (!Number.isInteger(oldPid) || oldPid <= 0) return reclaimLock('invalid_pid');
      if (oldPid === process.pid) return reclaimLock('same_pid');
      const ownerPid = await currentAgentPid();
      if (ownerPid && oldPid !== ownerPid) return reclaimLock('watchdog_owner_changed', { previous_pid: oldPid, current_agent_pid: ownerPid });
      try { process.kill(oldPid, 0); return false; }
      catch (probeError) {
        if (probeError?.code === 'ESRCH') return reclaimLock('stale_pid', { previous_pid: oldPid });
        if (probeError?.code === 'EPERM' || probeError?.code === 'EACCES') {
          const match = meditationProcessMatch(oldPid);
          if (match === false) return reclaimLock('stale_pid_permission_probe', { previous_pid: oldPid });
          return false;
        }
        return false;
      }
    } catch { return false; }
  }

  async function releaseLock() {
    try {
      const raw = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
      if (Number(raw?.pid) === process.pid) await fsp.rm(lockPath, { force: true });
    } catch {}
  }

  return Object.freeze({ root, statePath, lockPath, agentPidPath, load, save, acquireLock, releaseLock });
}

function createMeditationController({
  stateStore, commandSource, log, requestTick, checkpoint = async record => ({ status: 'local_only', record }),
  isUserIdle = async () => true, ensureNotepad = async () => {}, onModeChange = async () => {},
  onMissionEvent = async () => {}, heartbeat_ms = 30000, min_idle_seconds = 45,
  max_consecutive_failures = 3, now = () => new Date()
} = {}) {
  if (!stateStore || typeof stateStore.load !== 'function') throw new TypeError('stateStore required');
  for (const [name, fn] of Object.entries({ read: commandSource?.read, log, requestTick, checkpoint, isUserIdle, ensureNotepad, onModeChange, onMissionEvent })) if (typeof fn !== 'function') throw new TypeError(`${name} function required`);
  if (!Number.isInteger(heartbeat_ms) || heartbeat_ms < 10000) throw new TypeError('heartbeat_ms must be >= 10000');
  let state = defaultState(), timer = null, busy = false, locked = false;
  const persist = async () => stateStore.save(state);
  const status = () => Object.freeze({ ...state, failure_ledger: { ...state.failure_ledger } });
  const write = message => log(`[${VERSION}] ${message}`);
  const setMode = mode => { if (!MODES.includes(mode)) throw new Error(`invalid_mode:${mode}`); state = { ...state, mode }; };

  async function handleCommand(command) {
    const c = String(command || '').trim().toUpperCase();
    if (!COMMANDS.includes(c)) return { status: 'ignored', command: c || null };
    if (c === 'START' || c === 'AVANZA' || c === 'CONTINUA') {
      if (state.mode === 'active') return { status: 'already_active', command: c };
      if (!locked) { locked = await stateStore.acquireLock(); if (!locked) return { status: 'locked', reason: 'another_meditation_controller_is_active' }; }
      setMode('active'); state = { ...state, session_id: state.session_id || `med-${now().getTime()}-${process.pid}`, started_at: state.started_at || now().toISOString(), paused_at: null, stopped_at: null };
      await persist(); await ensureNotepad(); await write(`MODE ACTIVE command=${c}`); await onModeChange(status());
      if (!timer) timer = setInterval(() => { void tick('heartbeat'); }, heartbeat_ms);
      return { status: 'resumed', command: c };
    }
    if (c === 'PAUSA') { setMode('paused'); state = { ...state, paused_at: now().toISOString() }; await persist(); await write('MODE PAUSED command=PAUSA'); await onModeChange(status()); return { status: 'paused', command: c }; }
    if (c === 'CERRAR' || c === 'DETENER') { setMode('stopped'); state = { ...state, stopped_at: now().toISOString() }; await persist(); const cp = await checkpoint({ type: 'stop', reason: c, state: status(), session_id: state.session_id }); state = { ...state, last_checkpoint: cp }; await persist(); await write(`MODE STOPPED command=${c}`); await onModeChange(status()); return { status: 'stopped', command: c, checkpoint: cp }; }
    await write(`STATUS ${JSON.stringify(status())}`); return { status: 'reported', command: c };
  }

  async function consumeCommands() {
    const result = await commandSource.read(state.command_offset || 0); let next = state.command_offset || 0;
    for (const entry of result?.entries || []) { next = Math.max(next, Number(entry.next_offset || next)); const handled = await handleCommand(entry.command); if (handled.status === 'stopped') break; }
    if (next !== state.command_offset) { state = { ...state, command_offset: next }; await persist(); }
    return result?.entries || [];
  }

  async function tick(reason = 'scheduled') {
    if (busy) return { status: 'busy', reason }; busy = true; state = { ...state, tick_count: state.tick_count + 1, last_tick_at: now().toISOString() }; await persist();
    try {
      const entries = await consumeCommands(); if (state.mode !== 'active') return { status: 'inactive', mode: state.mode, commands: entries.length };
      if (!(await isUserIdle()) && min_idle_seconds > 0) { await write(`USER_PRESENT reason=${reason} execution_deferred=true`); return { status: 'deferred_user_present', tick: state.tick_count }; }
      await ensureNotepad(); const response = await requestTick({ state: status(), reason, tick: state.tick_count }); state = { ...state, last_result: response };
      if (response?.mission_created) { state = { ...state, active_mission_id: response.mission_created, active_goal: response.goal || null }; await onMissionEvent({ type: 'mission_created', ...response }); await write(`MISSION CREATED id=${response.mission_created} goal=${JSON.stringify(response.goal || '')}`); }
      else if (response?.active_mission_id) state = { ...state, active_mission_id: response.active_mission_id, active_goal: response.goal || null };
      else if (response?.status === 'idle') await write(`IDLE tick=${state.tick_count}`);
      const failed = response?.status === 'failed' || response?.ok === false;
      if (failed) {
        const key = fingerprintMission(response?.goal || response?.mission_created || response); const previous = state.failure_ledger[key] || { consecutive: 0, total: 0 };
        const failure = { consecutive: previous.consecutive + 1, total: previous.total + 1, last_error: response?.error || response?.status, last_at: now().toISOString() };
        state = { ...state, failure_ledger: { ...state.failure_ledger, [key]: failure }, last_error: failure.last_error }; await persist(); await write(`FAILURE consecutive=${failure.consecutive} total=${failure.total}`);
        if (failure.consecutive >= max_consecutive_failures) { await write('FAILURE_THRESHOLD reached=3 action=alternate_strategy_requested'); await onMissionEvent({ type: 'fallback_requested', consecutive_failures: failure.consecutive, mission: response, reason: 'same_goal_failed_3_times' }); }
      }
      const cp = await checkpoint({ type: 'tick', reason, state: status(), response }); state = { ...state, last_checkpoint: cp }; await persist(); return { status: 'completed', tick: state.tick_count, response, checkpoint: cp };
    } catch (error) { state = { ...state, last_error: String(error?.message || error), last_result: { status: 'failed', error: String(error?.message || error) } }; await persist(); await write(`ERROR ${state.last_error}`); return { status: 'failed', tick: state.tick_count, error: state.last_error }; }
    finally { busy = false; }
  }

  async function start() {
    if (!locked) { locked = await stateStore.acquireLock(); if (!locked) return { status: 'locked', reason: 'another_meditation_controller_is_active' }; }
    state = await stateStore.load(); setMode('active'); state = { ...state, session_id: `med-${now().getTime()}-${process.pid}`, started_at: now().toISOString(), stopped_at: null, paused_at: null };
    await persist(); await ensureNotepad(); await write(`START session=${state.session_id} heartbeat_ms=${heartbeat_ms}`); await onModeChange(status()); if (!timer) timer = setInterval(() => { void tick('heartbeat'); }, heartbeat_ms); void tick('startup'); return { status: 'started', state: status() };
  }
  async function pause() { return handleCommand('PAUSA'); }
  async function resume() { return handleCommand('AVANZA'); }
  async function stop() { const result = await handleCommand('CERRAR'); if (timer) clearInterval(timer); timer = null; if (locked) { locked = false; await stateStore.releaseLock(); } return result; }
  async function shutdown() { if (timer) clearInterval(timer); timer = null; if (locked) { locked = false; await stateStore.releaseLock(); } }
  return Object.freeze({ version: VERSION, start, pause, resume, stop, shutdown, tick, status: () => status(), handleCommand, consumeCommands });
}

module.exports = Object.freeze({ VERSION, MODES, COMMANDS, fingerprintMission, createFileStateStore, createMeditationController });
