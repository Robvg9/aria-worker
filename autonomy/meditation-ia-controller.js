'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const VERSION = 'aria-meditation-ia-v1';
const MODES = Object.freeze(['standby', 'active', 'paused', 'stopped']);
const COMMANDS = Object.freeze(['START', 'AVANZA', 'CONTINUA', 'PAUSA', 'CERRAR', 'DETENER', 'ESTADO']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function fingerprintMission(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value || {});
  return raw.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
}

function defaultState() {
  return { version: VERSION, mode: 'standby', session_id: null, tick_count: 0, active_mission_id: null, active_goal: null, started_at: null, paused_at: null, stopped_at: null, last_tick_at: null, last_result: null, last_error: null, last_checkpoint: null, failure_ledger: {}, command_offset: 0 };
}

function createFileStateStore({ root_dir } = {}) {
  if (!root_dir) throw new TypeError('root_dir required');
  const root = path.resolve(root_dir);
  const statePath = path.join(root, 'state.json');
  const lockPath = path.join(root, 'controller.lock');
  async function ensureRoot() { await fsp.mkdir(root, { recursive: true }); }
  async function load() {
    await ensureRoot();
    try { return { ...defaultState(), ...JSON.parse(await fsp.readFile(statePath, 'utf8')) }; }
    catch { const state = defaultState(); await save(state); return state; }
  }
  async function save(state) {
    await ensureRoot();
    const temp = `${statePath}.${process.pid}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(temp, statePath);
    return state;
  }
  async function acquireLock() {
    await ensureRoot();
    try {
      const handle = await fsp.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }), 'utf8'); await handle.close(); return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const existing = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
        if (existing?.pid && existing.pid !== process.pid) {
          try { process.kill(Number(existing.pid), 0); return false; }
          catch {
            await fsp.rm(lockPath, { force: true });
            const handle = await fsp.open(lockPath, 'wx'); await handle.writeFile(JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString(), reclaimed: true }), 'utf8'); await handle.close(); return true;
          }
        }
      } catch {}
      return false;
    }
  }
  async function releaseLock() { await fsp.rm(lockPath, { force: true }); }
  return Object.freeze({ root, statePath, lockPath, load, save, acquireLock, releaseLock });
}

function createMeditationController({ stateStore, commandSource, log, requestTick, checkpoint = async record => ({ status: 'local_only', record }), isUserIdle = async () => true, ensureNotepad = async () => {}, onModeChange = async () => {}, onMissionEvent = async () => {}, heartbeat_ms = 30_000, min_idle_seconds = 45, max_consecutive_failures = 3, now = () => new Date() } = {}) {
  if (!stateStore || typeof stateStore.load !== 'function') throw new TypeError('stateStore required');
  requireFn(commandSource?.read, 'commandSource.read'); requireFn(log, 'log'); requireFn(requestTick, 'requestTick'); requireFn(checkpoint, 'checkpoint'); requireFn(isUserIdle, 'isUserIdle'); requireFn(ensureNotepad, 'ensureNotepad'); requireFn(onModeChange, 'onModeChange'); requireFn(onMissionEvent, 'onMissionEvent');
  if (!Number.isInteger(heartbeat_ms) || heartbeat_ms < 10_000) throw new TypeError('heartbeat_ms must be >= 10000');
  if (!Number.isInteger(min_idle_seconds) || min_idle_seconds < 0) throw new TypeError('min_idle_seconds must be >= 0');
  if (!Number.isInteger(max_consecutive_failures) || max_consecutive_failures < 1 || max_consecutive_failures > 10) throw new TypeError('max_consecutive_failures must be 1..10');
  let state = defaultState(); let timer = null; let busy = false; let locked = false;
  async function persist() { await stateStore.save(state); }
  function status() { return Object.freeze({ ...state, failure_ledger: { ...state.failure_ledger } }); }
  async function write(message) { await log(`[${VERSION}] ${message}`); }
  function setMode(mode) { if (!MODES.includes(mode)) throw new Error(`invalid_mode:${mode}`); state = { ...state, mode }; }
  async function handleCommand(command) {
    const normalized = String(command || '').trim().toUpperCase();
    if (!COMMANDS.includes(normalized)) return { status: 'ignored', command: normalized || null };
    if (normalized === 'START' || normalized === 'AVANZA' || normalized === 'CONTINUA') {
      if (state.mode === 'active') return { status: 'already_active', command: normalized };
      if (!locked) { locked = await stateStore.acquireLock(); if (!locked) return { status: 'locked', reason: 'another_meditation_controller_is_active' }; }
      setMode('active'); state = { ...state, session_id: state.session_id || `med-${now().getTime()}-${process.pid}`, started_at: state.started_at || now().toISOString(), paused_at: null, stopped_at: null };
      await persist(); await ensureNotepad(); await write(`MODE ACTIVE command=${normalized}`); await onModeChange(status());
      if (!timer) timer = setInterval(() => { void tick('heartbeat'); }, heartbeat_ms);
      return { status: 'resumed', command: normalized };
    }
    if (normalized === 'PAUSA') { setMode('paused'); state = { ...state, paused_at: now().toISOString() }; await persist(); await write('MODE PAUSED command=PAUSA'); await onModeChange(status()); return { status: 'paused', command: normalized }; }
    if (normalized === 'CERRAR' || normalized === 'DETENER') {
      setMode('stopped'); state = { ...state, stopped_at: now().toISOString() }; await persist();
      const checkpointRecord = await checkpoint({ type: 'stop', reason: normalized, state: status(), session_id: state.session_id }); state = { ...state, last_checkpoint: checkpointRecord }; await persist(); await write(`MODE STOPPED command=${normalized}`); await onModeChange(status());
      return { status: 'stopped', command: normalized, checkpoint: checkpointRecord };
    }
    await write(`STATUS ${JSON.stringify(status())}`); return { status: 'reported', command: normalized };
  }
  async function consumeCommands() {
    const commands = await commandSource.read(state.command_offset || 0); let nextOffset = state.command_offset || 0;
    for (const entry of commands?.entries || []) { nextOffset = Math.max(nextOffset, Number(entry.next_offset || nextOffset)); const result = await handleCommand(entry.command); if (result.status === 'stopped') break; }
    if (nextOffset !== state.command_offset) { state = { ...state, command_offset: nextOffset }; await persist(); }
    return commands?.entries || [];
  }
  async function recordFailure(mission, response) {
    const key = fingerprintMission(mission?.goal || mission?.mission_id || mission); const previous = state.failure_ledger[key] || { consecutive: 0, total: 0, last_error: null, last_at: null };
    const next = { consecutive: previous.consecutive + 1, total: previous.total + 1, last_error: response?.error || response?.status || 'failed', last_at: now().toISOString() };
    state = { ...state, failure_ledger: { ...state.failure_ledger, [key]: next }, last_error: next.last_error }; await persist(); return next;
  }
  async function clearFailure(mission) {
    const key = fingerprintMission(mission?.goal || mission?.mission_id || mission); if (!(key in state.failure_ledger)) return;
    state = { ...state, failure_ledger: { ...state.failure_ledger, [key]: { ...state.failure_ledger[key], consecutive: 0 } }, last_error: null }; await persist();
  }
  async function tick(reason = 'scheduled') {
    if (busy) return { status: 'busy', reason }; busy = true; state = { ...state, tick_count: state.tick_count + 1, last_tick_at: now().toISOString() }; await persist();
    try {
      const entries = await consumeCommands();
      if (state.mode !== 'active') return { status: 'inactive', mode: state.mode, commands: entries.length };
      const idle = await isUserIdle();
      if (!idle && min_idle_seconds > 0) { await write(`USER_PRESENT reason=${reason} execution_deferred=true`); return { status: 'deferred_user_present', tick: state.tick_count }; }
      await ensureNotepad();
      const response = await requestTick({ state: status(), reason, tick: state.tick_count }); state = { ...state, last_result: response };
      if (response?.mission_created) { state = { ...state, active_mission_id: response.mission_created, active_goal: response.goal || response.goal_text || null }; await onMissionEvent({ type: 'mission_created', ...response }); await write(`MISSION CREATED id=${response.mission_created} goal=${JSON.stringify(response.goal || response.goal_text || '')}`); }
      else if (response?.active_mission_id) { state = { ...state, active_mission_id: response.active_mission_id, active_goal: response.goal || null }; }
      else if (response?.status === 'idle') await write(`IDLE tick=${state.tick_count}`);
      if (response?.status === 'failed' || response?.ok === false) {
        const failure = await recordFailure(response, response); await write(`FAILURE consecutive=${failure.consecutive} total=${failure.total}`);
        if (failure.consecutive >= max_consecutive_failures) { await write('FAILURE_THRESHOLD reached=3 action=alternate_strategy_requested'); await onMissionEvent({ type: 'fallback_requested', consecutive_failures: failure.consecutive, mission: response, reason: 'same_goal_failed_3_times' }); }
      } else if (response?.mission_created || response?.active_mission_id) await clearFailure(response);
      const checkpointRecord = await checkpoint({ type: 'tick', reason, state: status(), response }); state = { ...state, last_checkpoint: checkpointRecord }; await persist();
      return Object.freeze({ status: 'completed', tick: state.tick_count, response, checkpoint: checkpointRecord });
    } catch (error) {
      state = { ...state, last_error: String(error?.message || error), last_result: { status: 'failed', error: String(error?.message || error) } }; await persist(); await write(`ERROR ${state.last_error}`); return Object.freeze({ status: 'failed', tick: state.tick_count, error: state.last_error });
    } finally { busy = false; }
  }
  async function start() {
    if (!locked) { locked = await stateStore.acquireLock(); if (!locked) return { status: 'locked', reason: 'another_meditation_controller_is_active' }; }
    state = await stateStore.load(); setMode('active'); state = { ...state, session_id: `med-${now().getTime()}-${process.pid}`, started_at: now().toISOString(), stopped_at: null, paused_at: null }; await persist(); await ensureNotepad(); await write(`START session=${state.session_id} heartbeat_ms=${heartbeat_ms}`); await onModeChange(status());
    if (!timer) timer = setInterval(() => { void tick('heartbeat'); }, heartbeat_ms); void tick('startup'); return Object.freeze({ status: 'started', state: status() });
  }
  async function pause() { return handleCommand('PAUSA'); }
  async function resume() { return handleCommand('AVANZA'); }
  async function stop() { const result = await handleCommand('CERRAR'); if (timer) clearInterval(timer); timer = null; if (locked) { locked = false; await stateStore.releaseLock(); } return result; }
  async function shutdown() { if (timer) clearInterval(timer); timer = null; if (locked) { locked = false; await stateStore.releaseLock(); } }
  return Object.freeze({ version: VERSION, start, pause, resume, stop, shutdown, tick, status: () => status(), handleCommand, consumeCommands, constants: Object.freeze({ VERSION, MODES, COMMANDS }) });
}

module.exports = Object.freeze({ VERSION, MODES, COMMANDS, fingerprintMission, createFileStateStore, createMeditationController });
