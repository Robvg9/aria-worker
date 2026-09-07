'use strict';

const VERSION = 'aria-computer-use-v1.0.0';
const ACTIONS = Object.freeze(['navigate','click','type','press','scroll','select','wait']);
const RISKS = Object.freeze(['read','low_risk_write','high_risk_write','destructive']);
const TERMINAL = new Set(['succeeded','failed','blocked','cancelled','verification_failed']);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((o,k)=>{ o[k]=stable(value[k]); return o; },{});
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function looksSecret(value) {
  const s = typeof value === 'string' ? value : canonical(value);
  return /(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN .*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]{12,})/.test(s);
}

function normalizeNode(node) {
  if (!node || typeof node !== 'object') throw new TypeError('ui_node_required');
  if (!node.id || !node.role) throw new TypeError('ui_node_id_role_required');
  return Object.freeze({
    id: String(node.id),
    role: String(node.role),
    name: node.name == null ? null : String(node.name),
    text: node.text == null ? null : String(node.text),
    label: node.label == null ? null : String(node.label),
    enabled: node.enabled !== false,
    visible: node.visible !== false,
    parent_id: node.parent_id == null ? null : String(node.parent_id),
    attributes: clone(node.attributes || {})
  });
}

function createUiState(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('ui_state_required');
  if (looksSecret(input)) throw new TypeError('secret_material_rejected');
  const nodes = Array.isArray(input.nodes) ? input.nodes.map(normalizeNode) : [];
  const ids = new Set();
  for (const node of nodes) {
    if (ids.has(node.id)) throw new TypeError('duplicate_ui_node_id');
    ids.add(node.id);
  }
  return Object.freeze({
    version: 'ui-state-v1.0.0',
    surface: input.surface == null ? 'unknown' : String(input.surface),
    url: input.url == null ? null : String(input.url),
    title: input.title == null ? null : String(input.title),
    focused_id: input.focused_id == null ? null : String(input.focused_id),
    nodes: Object.freeze(nodes),
    metadata: Object.freeze(clone(input.metadata || {}))
  });
}

function findElement(ui, query) {
  if (!ui || !Array.isArray(ui.nodes)) return {status:'not_found', candidates:[]};
  if (!query || typeof query !== 'object') throw new TypeError('element_query_required');
  const role = query.role == null ? null : String(query.role).toLowerCase();
  const name = query.name == null ? null : String(query.name).toLowerCase();
  const text = query.text == null ? null : String(query.text).toLowerCase();
  const label = query.label == null ? null : String(query.label).toLowerCase();
  const attr = query.attribute && typeof query.attribute === 'object' ? query.attribute : null;
  const candidates = ui.nodes.filter(n => n.visible &&
    (!role || n.role.toLowerCase() === role) &&
    (!name || (n.name || '').toLowerCase() === name) &&
    (!text || (n.text || '').toLowerCase().includes(text)) &&
    (!label || (n.label || '').toLowerCase().includes(label)) &&
    (!attr || Object.entries(attr).every(([k,v]) => n.attributes && n.attributes[k] === v))
  );
  if (candidates.length === 1) return {status:'found', element:clone(candidates[0]), candidates:[clone(candidates[0])]};
  if (candidates.length > 1) return {status:'ambiguous', candidates:clone(candidates)};
  return {status:'not_found', candidates:[]};
}

function createAction(input) {
  if (!input || typeof input !== 'object') throw new TypeError('action_required');
  if (!ACTIONS.includes(input.action)) throw new TypeError('unsupported_action');
  if (!input.id) throw new TypeError('action_id_required');
  if (looksSecret(input)) throw new TypeError('secret_material_rejected');
  if (['click','type','select'].includes(input.action) && !input.target) throw new TypeError('target_required');
  if (input.action === 'type' && typeof input.text !== 'string') throw new TypeError('text_required');
  const risk = input.risk || 'read';
  if (!RISKS.includes(risk)) throw new TypeError('risk_invalid');
  return Object.freeze({
    id:String(input.id), action:input.action, target:clone(input.target || null), text:input.text == null ? null : String(input.text),
    value:input.value == null ? null : clone(input.value), risk, reason:input.reason == null ? null : String(input.reason),
    expectation:clone(input.expectation || null), metadata:clone(input.metadata || {})
  });
}

function planAction({id, intent, ui, preferredTarget, risk='read'} = {}) {
  if (!id || typeof intent !== 'string' || !intent.trim()) throw new TypeError('intent_required');
  if (!RISKS.includes(risk)) throw new TypeError('risk_invalid');
  if (!ui) throw new TypeError('ui_state_required');
  const target = preferredTarget || {};
  const match = findElement(ui, target);
  if (match.status === 'not_found') return {status:'blocked', reason:'element_not_found', intent, diagnostics:{query:clone(target)}};
  if (match.status === 'ambiguous') return {status:'blocked', reason:'element_ambiguous', intent, diagnostics:{query:clone(target), candidates:match.candidates.map(x=>x.id)}};
  const action = createAction({
    id, action:target.action || 'click', target:{ref:match.element.id, query:clone(target)},
    text:target.text, value:target.value, risk, reason:intent, expectation:target.expectation
  });
  return {status:'planned', action};
}

function verifyObservation({before, after, expectation} = {}) {
  if (!after || typeof after !== 'object') return {valid:false, reason:'observation_missing'};
  if (!expectation) return {valid:true, reason:'no_explicit_expectation'};
  const checks = [];
  if (expectation.url != null) checks.push(after.url === expectation.url);
  if (expectation.title != null) checks.push(after.title === expectation.title);
  if (expectation.present) checks.push(expectation.present.every(q => findElement(after,q).status === 'found'));
  if (expectation.absent) checks.push(expectation.absent.every(q => findElement(after,q).status === 'not_found'));
  if (expectation.text) checks.push(String(after.metadata && after.metadata.body_text || '').includes(String(expectation.text)));
  const valid = checks.every(Boolean);
  return {valid, reason:valid ? 'verified' : 'expectation_mismatch', checks};
}

function createLearningBridge({recordLesson} = {}) {
  return Object.freeze({
    recordFailure(input) {
      if (typeof recordLesson !== 'function') return {status:'not_connected'};
      const safe = clone(input || {});
      if (looksSecret(safe)) return {status:'blocked', reason:'secret_material_rejected'};
      return recordLesson({kind:'computer_use_failure', reusable:false, evidence:safe});
    },
    recordSuccess(input) {
      if (typeof recordLesson !== 'function') return {status:'not_connected'};
      const safe = clone(input || {});
      if (looksSecret(safe)) return {status:'blocked', reason:'secret_material_rejected'};
      return recordLesson({kind:'computer_use_lesson_candidate', reusable:true, evidence:safe});
    }
  });
}

function createComputerRuntime({adapter, learning, approval} = {}) {
  if (!adapter || typeof adapter.observe !== 'function' || typeof adapter.execute !== 'function') throw new TypeError('adapter_required');
  const learner = learning || createLearningBridge({});
  const maxRecovery = 2;

  async function executeMission({mission_id, ui, intent, target, risk='read', expectation, recovery=true} = {}) {
    if (!mission_id) throw new TypeError('mission_id_required');
    let current = ui || await adapter.observe({mission_id});
    if (looksSecret(current)) return {status:'blocked', reason:'secret_material_rejected'};
    for (let attempt=0; attempt<=maxRecovery; attempt += 1) {
      const planned = planAction({id:`${mission_id}-a${attempt+1}`, intent, ui:current, preferredTarget:{...(target||{}), expectation}, risk});
      if (planned.status !== 'planned') {
        if (attempt < maxRecovery && recovery) {
          current = await adapter.observe({mission_id, recovery:true, reason:planned.reason});
          continue;
        }
        learner.recordFailure({mission_id, phase:'planning', reason:planned.reason});
        return {status:'blocked', reason:planned.reason, attempt};
      }
      if (['high_risk_write','destructive'].includes(risk)) {
        if (!approval || approval.status !== 'approved') return {status:'blocked', reason:'human_approval_required', action:planned.action};
      }
      const result = await adapter.execute({mission_id, action:planned.action});
      if (!result || TERMINAL.has(result.status) === false) return {status:'verification_failed', reason:'invalid_executor_result'};
      if (result.status !== 'succeeded') {
        if (attempt < maxRecovery && recovery) { current = await adapter.observe({mission_id, recovery:true, reason:result.reason || result.status}); continue; }
        learner.recordFailure({mission_id, phase:'execution', result:clone(result)});
        return {status:result.status, result:clone(result), attempt};
      }
      const after = result.ui || await adapter.observe({mission_id});
      const verification = verifyObservation({before:current, after, expectation});
      if (verification.valid) {
        learner.recordSuccess({mission_id, intent, action:planned.action, verification});
        return {status:'succeeded', action:planned.action, verification, ui:after, attempt};
      }
      if (attempt < maxRecovery && recovery) { current = after; continue; }
      learner.recordFailure({mission_id, phase:'verification', verification});
      return {status:'verification_failed', verification, ui:after, attempt};
    }
    return {status:'failed', reason:'recovery_exhausted'};
  }
  return Object.freeze({version:VERSION, executeMission});
}

module.exports = Object.freeze({VERSION,ACTIONS,RISKS,createUiState,findElement,createAction,planAction,verifyObservation,createLearningBridge,createComputerRuntime});
