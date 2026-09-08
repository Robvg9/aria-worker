'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-eas-patch-'));
const file = path.join(tmp, 'index.ts');

const fixture = `const AGENT = \`\${URL}/functions/v1/aria-agent-runtime-v1\`;\n\nfunction validateStep(step: any) {\n  const type = executorType(step);\n  if (!["connector", "device", "model", "agent"].includes(type)) {\n    throw new Error(\`unknown_executor_type:\${type}\`);\n  }\n  if (type === "agent" && !step.target?.agent_id) throw new Error("agent_target_missing");\n}\n\nasync function connectorExecute() { return { status: "succeeded" }; }\nasync function deviceExecute() { return { status: "succeeded" }; }\nasync function modelExecute() { return { status: "succeeded" }; }\nasync function agentExecute() { return { status: "succeeded" }; }\n\nasync function executeStep(missionId: string, step: any, token: string | null) {\n  validateStep(step);\n  const type = executorType(step);\n  if (type === "connector") return connectorExecute(missionId, step);\n  if (type === "device") return deviceExecute(missionId, step);\n  if (type === "model") return modelExecute(missionId, step, token);\n  if (type === "agent") return agentExecute(missionId, step, token);\n  throw new Error(\`unknown_executor_type:\${type}\`);\n}\n`;

fs.writeFileSync(file, fixture);
const result = spawnSync(process.execPath, [path.join(root, 'scripts/patch-eas-into-mission-runner-v22.js'), file], { encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
const output = fs.readFileSync(file, 'utf8');
assert.match(output, /const EAS_API = 'https:\\/\\/api\.expo\.dev';/);
assert.match(output, /type === "eas"/);
assert.match(output, /easExecute/);
assert.match(output, /eas_project_target_mismatch/);
assert.match(output, /eas\.workflow_dispatch/);
console.log('EAS runner patch transformer PASS');
