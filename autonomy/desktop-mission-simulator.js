'use strict';

const { executePlan } = require('./desktop-mission-orchestrator');

function createWindowsMissionSimulator({ initial = {} } = {}) {
  const state = {
    foreground: initial.foreground || 'Desktop',
    open_apps: new Set(initial.open_apps || []),
    typed: [],
    commands: [],
    observations: 0,
    screenshots: 0,
    output: initial.output || '',
    clock: initial.clock || '2026-09-12T12:00:00.000Z'
  };

  async function execute({ step }) {
    const p = step.payload || {};
    if (step.type === 'computer.use') {
      switch (p.action) {
        case 'observe':
          state.observations += 1;
          return { status: 'succeeded', foreground: state.foreground, open_apps: [...state.open_apps] };
        case 'screenshot':
          state.screenshots += 1;
          return { status: 'succeeded', screenshot_base64: 'SIMULATED_SCREENSHOT', width: 1920, height: 1080 };
        case 'open':
          state.open_apps.add(String(p.target));
          state.foreground = String(p.target);
          return { status: 'succeeded', opened: p.target };
        case 'focus':
          if (!state.open_apps.has(String(p.target))) return { status: 'failed', error: 'window_not_open' };
          state.foreground = String(p.target);
          return { status: 'succeeded', focused: p.target };
        case 'type':
          state.typed.push(String(p.text));
          return { status: 'succeeded', typed_length: String(p.text).length };
        case 'keypress':
          return { status: 'succeeded', key: p.key };
        case 'click':
          return { status: 'succeeded', clicked: p };
        case 'scroll':
          return { status: 'succeeded', scroll: p };
        default:
          return { status: 'failed', error: 'unsupported_action' };
      }
    }
    if (step.type === 'shell.execute') {
      const script = String(p.script);
      state.commands.push(script);
      if (script === 'Get-Date') return { status: 'succeeded', stdout: state.clock, stderr: '', exit_code: 0 };
      if (script === 'ollama --version') return { status: 'succeeded', stdout: 'ollama version 0.0-simulated', stderr: '', exit_code: 0 };
      return { status: 'succeeded', stdout: state.output || 'SIMULATED_OK', stderr: '', exit_code: 0 };
    }
    return { status: 'failed', error: 'unsupported_operation' };
  }

  async function verify({ result }) {
    return { ok: Boolean(result && result.status === 'succeeded') };
  }

  async function run(plan) {
    const result = await executePlan(plan, execute, verify);
    return Object.freeze({ result, state: snapshot() });
  }

  function snapshot() {
    return Object.freeze({
      foreground: state.foreground,
      open_apps: Object.freeze([...state.open_apps]),
      typed: Object.freeze([...state.typed]),
      commands: Object.freeze([...state.commands]),
      observations: state.observations,
      screenshots: state.screenshots,
      output: state.output,
      clock: state.clock
    });
  }

  return Object.freeze({ execute, verify, run, snapshot });
}

module.exports = Object.freeze({ createWindowsMissionSimulator });
