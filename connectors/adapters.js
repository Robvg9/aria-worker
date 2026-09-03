'use strict';
const { createHttpAdapter } = require('./http-adapter');

const SPECS = Object.freeze({
  github: ['repo_read','file_read','file_write','branch_create','pull_request','workflow_dispatch'],
  supabase: ['db_read','migration','edge_function','logs'],
  cloudflare: ['worker_read','worker_write','deploy','logs'],
  notion: ['page_read','page_write','search'],
  web: ['search','fetch'],
  image: ['generate','edit'],
  filesystem: ['read','write','list']
});

function createConnectorAdapters({ transports = {} } = {}) {
  const map = {};
  for (const [id, operations] of Object.entries(SPECS)) {
    const request = transports[id];
    if (typeof request === 'function') map[id] = createHttpAdapter({ connector_id: id, operations, request });
  }
  return Object.freeze(map);
}

module.exports = { SPECS, createConnectorAdapters };
