'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'aria-agent-runtime-v1', 'index.ts');
const source = fs.readFileSync(file, 'utf8');

assert.match(source, /aria-agent-planner-v1/);
assert.match(source, /aria-agent-reviewer-v1/);
assert.match(source, /aria-agent-research-v1/);
assert.match(source, /aria-agent-coding-v1/);
assert.match(source, /aria-agent-security-v1/);
assert.match(source, /aria-agent-memory-v1/);
assert.match(source, /aria-agent-business-v1/);
assert.match(source, /aria-agent-device-v1/);
assert.match(source, /operation.*delegate/);
assert.match(source, /executor_type.*agent/);
assert.match(source, /aria-execution-runtime-v1/);
assert.match(source, /const requestId = `agent:/);
assert.match(source, /request_id:\s*requestId/);
assert.match(source, /authorization/);
assert.match(source, /risk_class/);
assert.match(source, /aria_agent_catalog/);
assert.match(source, /agent_unavailable_or_not_cataloged/);
assert.match(source, /prompt_missing/);
assert.doesNotMatch(source, /OPENAI_API_KEY|GOOGLE_API_KEY|GROK_API_KEY|sk-[A-Za-z0-9]{10,}/);
assert.doesNotMatch(source, /console\.log\s*\(.*SECRET/);

console.log('AGENT RUNTIME V1 CONTRACT: PASS');
