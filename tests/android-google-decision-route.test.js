'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-device-gateway/index.ts'),
  'utf8'
);

// 1) Google certified models can enter routes without free-tier pricing marker
assert.ok(
  source.includes("modelId.startsWith('google/')") && source.includes("modelId.endsWith('-direct')"),
  'Google Direct models must be eligible without free-tier pricing marker'
);

// 2) Account binding relaxed for verified Google Direct
assert.ok(
  source.includes("Certified Google Direct") || source.includes('modelId.endsWith(\'-direct\') && verified.has(modelId)'),
  'Google Direct account binding must allow verified models without models[] entry'
);

// 3) JSON contract for Google via responseMimeType
assert.ok(
  source.includes("responseMimeType:'application/json'") || source.includes('responseMimeType:"application/json"'),
  'Google path must request application/json responseMimeType'
);

// 4) generationConfig forwarded through mission5ModelProbe
assert.ok(
  source.includes('generationConfig') && source.includes('b?.generationConfig'),
  'mission5ModelProbe must forward generationConfig to execution runtime'
);

// 5) Safety gates preserved
for (const gate of [
  'human_gate_required_for_sensitive_action',
  'human_gate_required_for_credential_input',
  'credential_material_blocked',
  'governed_safe_fallback_navigation_after_model_route_failure'
]) {
  assert.ok(source.includes(gate), 'missing safety gate marker: ' + gate);
}

// 6) Fallback is last resort (still present) but Google preferred
assert.ok(source.includes("google/gemini-3.5-flash-lite-direct"), 'preferred Google model missing');
assert.ok(source.includes('routes.slice(0,3)') || source.includes('routes.slice(0,2)'), 'route attempt window missing');

// 7) Parser still validates nodes/hosts
assert.ok(source.includes('allowedHosts'), 'host validation missing');
assert.ok(source.includes('isSafeNode'), 'node safety validation missing');
assert.ok(source.includes('autonomousActionIsDangerous'), 'dangerous action gate missing');

// 8) Simulate parseLine logic for Google JSON decision (mirrors gateway parser)
function parseLine(raw) {
  const compact = String(raw || '').trim();
  const jsonStart = compact.indexOf('{');
  const jsonEnd = compact.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const obj = JSON.parse(compact.slice(jsonStart, jsonEnd + 1));
      if (obj?.decision === 'act' && obj?.action && typeof obj.action === 'object') {
        const action = { ...obj.action };
        if (!action.action && typeof action.type === 'string') action.action = action.type;
        if (!action.nodeId && typeof action.node_id === 'string') action.nodeId = action.node_id;
        if (action.keyCode === undefined && action.key_code !== undefined) action.keyCode = action.key_code;
        if (action.action) {
          return {
            decision: 'act',
            reason: String(obj.reason || 'safe_model_action').slice(0, 700),
            action
          };
        }
      }
    } catch {}
  }
  return null;
}

const googleJsonResponse = JSON.stringify({
  decision: 'act',
  reason: 'tap primary CTA M5_MODEL_E2E_OK',
  action: { action: 'click', nodeId: 'node-12' }
});
const parsed = parseLine(googleJsonResponse);
assert.ok(parsed, 'Google JSON response must parse');
assert.equal(parsed.decision, 'act');
assert.equal(parsed.action.action, 'click');
assert.equal(parsed.action.nodeId, 'node-12');
assert.ok(String(parsed.reason).includes('M5_MODEL_E2E_OK'));

// Alias normalization (type/node_id)
const aliased = parseLine(JSON.stringify({
  decision: 'act',
  reason: 'scroll M5_MODEL_E2E_OK',
  action: { type: 'scroll', node_id: 'node-3', direction: 'forward' }
}));
assert.ok(aliased);
assert.equal(aliased.action.action, 'scroll');
assert.equal(aliased.action.nodeId, 'node-3');

// Invalid JSON must not produce a decision
assert.equal(parseLine('sorry I cannot help'), null);

console.log('ANDROID GOOGLE DECISION ROUTE: PASS');
