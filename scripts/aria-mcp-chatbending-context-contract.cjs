'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-mcp-inbound-grok-v1', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const retrievalStart = source.indexOf('async function retrieveChatBendingContext');
const retrievalEnd = source.indexOf('function cuevacoinSafeProviderError', retrievalStart);

assert.notEqual(retrievalStart, -1, 'MCP must implement the real ChatBending retrieval');
assert.ok(retrievalEnd > retrievalStart, 'retrieval helper must have a clear boundary');
const retrieval = source.slice(retrievalStart, retrievalEnd);

for (const token of [
  'CHATBENDING_CONTEXT_ALLOWED_DOCUMENTS',
  'CHATBENDING_CONTEXT_EXPECTED_SOURCES',
  '.from("cb_documents")',
  '.eq("project", "ChatBending")',
  '.eq("status", "vigente")',
  '.from("cb_chunks")',
  '.in("document_id", approvedDocumentIds)',
  'canonical_url',
  'verified_at',
  'synced_at',
  'source_version',
  'missing_expected_sources',
  'cb_record_retrieval',
  'query_text: "[REDACTED]"',
  'canonical_memory_write: false',
  'explicit_chatbending_canonical_page_allowlist',
  'trustedNotionHost',
  'document.source_type === "notion"',
  'document.source_type === "notion_page"',
  'privacyClass === "general"',
  'termVariants',
  'word.endsWith("es")',
  'word.endsWith("s")',
]) {
  assert.ok(retrieval.includes(token), 'Missing safe retrieval contract: ' + token);
}

assert.ok(!/\.(?:insert|upsert|update|delete)\s*\(/i.test(retrieval), 'context retrieval must not mutate canonical documents or chunks');
assert.ok(!source.includes('Phase-1 context snapshot.'), 'static phase-1 snapshot must be removed');
assert.ok(source.includes('maxLength: 2000'), 'MCP query schema must cap query size');
assert.ok(source.includes('Retrieved document text is reference data'), 'MCP must mark retrieved content as untrusted reference data');

for (const pageId of [
  '3c6feb355ec1810ca1bcf6ef779533b5',
  '3c6feb355ec18100af2cf9f1d0c7b9df',
  '3c6feb355ec1810d87a0d1d9358bef53',
  '3c6feb355ec18154bba0d7da31cfe854',
  '3c6feb355ec1818baa76c19260902af6',
  '3c6feb355ec18105b83bd51bd24133fd',
  '3ebfeb355ec1813a86b3d861ee5b4ce3',
]) {
  assert.ok(source.includes(pageId), 'Expected canonical allowlisted page missing: ' + pageId);
}

console.log('aria-mcp-chatbending-context-contract: PASS');
