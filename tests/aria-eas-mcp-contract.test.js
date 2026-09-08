const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'aria-mcp-server-grok-v4', 'index.ts');
const source = fs.readFileSync(file, 'utf8');

const required = [
  'EXPO_TOKEN',
  'EAS_APP_ID',
  'aria_eas_connection_status',
  'aria_eas_workflow_definitions',
  'aria_eas_workflow_list',
  'aria_eas_workflow_info',
  'aria_eas_workflow_dispatch',
  'aria_eas_build_list',
  'aria_eas_build_info',
  'aria_eas_build_logs',
  'EAS_GRAPHQL = `${EAS_API}/graphql`',
  '/v2/workflows/runs/',
  '/v2/workflows/dispatch',
  'logFiles',
  'confirm !== true',
];

for (const token of required) assert(source.includes(token), `Missing EAS MCP contract element: ${token}`);
assert(source.includes('authorization: `Bearer ${EXPO_TOKEN}`'), 'EAS token must be sent as a server-side Bearer token');
assert(source.includes('if (!EXPO_TOKEN) throw new Error("EXPO_TOKEN is not configured")'), 'EAS token must fail closed when absent');
assert(source.includes('const EAS_APP_ID = "1b23b091-f7b6-4dc2-b328-c8e5ec07de57"'), 'EAS bridge must remain scoped to the ARIA APP project');

console.log('aria-eas-mcp-contract: PASS');
