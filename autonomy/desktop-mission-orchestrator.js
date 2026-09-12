'use strict';

const VERSION = 'aria-desktop-mission-orchestrator-v1';
const COMPUTER_OPERATION = 'computer.use';
const SHELL_OPERATION = 'shell.execute';

const ALLOWED_COMPUTER_ACTIONS = new Set(['screenshot', 'observe', 'open', 'focus', 'click', 'type', 'keypress', 'scroll']);
const SAFE_SHELL_PREFIXES = ['Get-Process', 'Get-Service', 'Get-ChildItem', 'Get-Location', 'Get-Date', 'Write-Output', 'Test-Path', 'Get-Command', 'ollama list', 'ollama --version', 'node --version', 'npm --version', 'git status'];

function normalizeGoal(goal) {
  if (typeof goal !== 'string') throw new TypeError('goal must be a string');
  const normalized = goal.trim();
  if (!normalized) throw new TypeError('goal must not be empty');
  return normalized;
}

function isAllowedShellScript(script) {
  if (typeof script !== 'string') return false;
  const value = script.trim();
  if (!value || value.length > 2000) return false;
  if (/\b(Remove-Item|Stop-Process|Stop-Service|Restart-Computer|shutdown|format|del|rd|rmdir|taskkill)\b/i.test(value)) return false;
  return SAFE_SHELL_PREFIXES.some(prefix => value.toLowerCase().startsWith(prefix.toLowerCase()));
}

function action(type, payload = {}) { return Object.freeze({ type, payload }); }

function chooseStrategy(goal) {
  const text = goal.toLowerCase();
  if (/abre|abrir|open|chrome|notepad|powershell|ventana|aplicaci[oó]n|click|clic|bot[oó]n|escribe|escribir|tecla|scroll|pantalla|captura/.test(text)) return 'computer';
  if (/ejecuta|ejecutar|comando|powershell|terminal|ollama|node|npm|git|proceso|servicio|carpeta|archivo/.test(text)) return 'shell';
  return 'hybrid';
}

function compileMission({ goal, target = 'windows-local', constraints = {} } = {}) {
  const normalizedGoal = normalizeGoal(goal);
  const strategy = chooseStrategy(normalizedGoal);
  const steps = [];
  if (strategy === 'computer' || strategy === 'hybrid') steps.push(action(COMPUTER_OPERATION, { action: 'observe' }));
  if (/powershell|terminal/i.test(normalizedGoal) && strategy !== 'shell') {
    steps.push(action(COMPUTER_OPERATION, { action: 'open', path: 'powershell.exe' }));
  }
  if (strategy === 'shell' || strategy === 'hybrid') {
    steps.push(action(COMPUTER_OPERATION, { action: 'open', path: 'powershell.exe' }));
    steps.push(action(COMPUTER_OPERATION, { action: 'focus', process: 'powershell' }));
  }
  if (/ollama.*(funciona|running|activo|active|version)|versi[oó]n.*ollama/i.test(normalizedGoal)) {
    steps.push(action(COMPUTER_OPERATION, { action: 'type', text: 'ollama --version' }));
    steps.push(action(COMPUTER_OPERATION, { action: 'keypress', key: 'ENTER' }));
    steps.push(action(COMPUTER_OPERATION, { action: 'observe' }));
  } else if (/comprueba|verifica|check|status|estado/i.test(normalizedGoal)) {
    steps.push(action(SHELL_OPERATION, { script: 'Get-Date' }));
  } else if (strategy === 'computer') {
    steps.push(action(COMPUTER_OPERATION, { action: 'screenshot' }));
  }
  steps.push(action(COMPUTER_OPERATION, { action: 'observe' }));

  return Object.freeze({
    version: VERSION,
    mission_id: `desktop-${Date.now()}`,
    goal: normalizedGoal,
    target,
    strategy,
    constraints: Object.freeze({ max_steps: 12, require_observation_after_action: true, ...constraints }),
    steps: Object.freeze(steps)
  });
}

function validateStep(step) {
  if (!step || typeof step !== 'object') return { ok: false, reason: 'step_invalid' };
  if (step.type === COMPUTER_OPERATION) {
    const op = step.payload || {};
    if (!ALLOWED_COMPUTER_ACTIONS.has(op.action)) return { ok: false, reason: 'computer_action_not_allowed' };
    if (op.action === 'type' && (typeof op.text !== 'string' || op.text.length > 4000)) return { ok: false, reason: 'type_payload_invalid' };
    if (op.action === 'open' && (typeof op.path !== 'string' || !op.path.trim())) return { ok: false, reason: 'open_payload_invalid' };
    if (op.action === 'focus' && (typeof op.process !== 'string' || !op.process.trim())) return { ok: false, reason: 'focus_payload_invalid' };
    if (op.action === 'click' && (!Number.isInteger(op.x) || !Number.isInteger(op.y))) return { ok: false, reason: 'click_payload_invalid' };
    if (op.action === 'keypress' && (typeof op.key !== 'string' || !op.key.trim())) return { ok: false, reason: 'keypress_payload_invalid' };
    if (op.action === 'scroll' && !Number.isInteger(op.delta)) return { ok: false, reason: 'scroll_payload_invalid' };
    return { ok: true };
  }
  if (step.type === SHELL_OPERATION) return isAllowedShellScript(step.payload?.script) ? { ok: true } : { ok: false, reason: 'shell_policy_blocked' };
  return { ok: false, reason: 'operation_not_supported' };
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return { ok: false, reason: 'plan_invalid' };
  if (plan.steps.length > (plan.constraints?.max_steps || 12)) return { ok: false, reason: 'max_steps_exceeded' };
  for (const step of plan.steps) { const result = validateStep(step); if (!result.ok) return result; }
  return { ok: true };
}

async function executePlan(plan, execute, verify = async () => ({ ok: true })) {
  if (typeof execute !== 'function') throw new TypeError('execute function required');
  if (typeof verify !== 'function') throw new TypeError('verify function required');
  const validation = validatePlan(plan);
  if (!validation.ok) return Object.freeze({ status: 'blocked', ...validation });
  const results = [];
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    const result = await execute({ step, index: i, plan });
    results.push({ index: i, step, result });
    const verification = await verify({ step, result, index: i, plan, results: [...results] });
    if (!verification || verification.ok !== true) return Object.freeze({ status: 'needs_replan', failed_index: i, results, verification });
  }
  return Object.freeze({ status: 'succeeded', results });
}

module.exports = Object.freeze({ VERSION, COMPUTER_OPERATION, SHELL_OPERATION, compileMission, validatePlan, validateStep, executePlan, isAllowedShellScript });
