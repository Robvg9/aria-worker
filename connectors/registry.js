'use strict';

const CONNECTORS = Object.freeze([
  { connector_id: 'github', name: 'GitHub', interface_type: 'api', status: 'planned', operations: ['repo_read','file_read','file_write','branch_create','pull_request','workflow_dispatch'] },
  { connector_id: 'supabase', name: 'Supabase', interface_type: 'api', status: 'planned', operations: ['db_read','migration','edge_function','logs'] },
  { connector_id: 'cloudflare', name: 'Cloudflare', interface_type: 'api', status: 'planned', operations: ['worker_read','worker_write','deploy','logs'] },
  { connector_id: 'notion', name: 'Notion / ChatBending', interface_type: 'api', status: 'planned', operations: ['page_read','page_write','search'] },
  { connector_id: 'web', name: 'Web Research', interface_type: 'http', status: 'planned', operations: ['search','fetch'] },
  { connector_id: 'image', name: 'Image Generation', interface_type: 'ai', status: 'planned', operations: ['generate','edit'] },
  { connector_id: 'filesystem', name: 'Workspace Filesystem', interface_type: 'local', status: 'planned', operations: ['read','write','list'] }
]);

function listConnectors() { return CONNECTORS.map((x) => structuredClone(x)); }
function getConnector(id) { const c = CONNECTORS.find((x) => x.connector_id === id); return c ? structuredClone(c) : null; }

module.exports = { CONNECTORS, listConnectors, getConnector };
