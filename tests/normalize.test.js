const assert = require("node:assert/strict");
const {
  normalizeSourceApplication,
  assertNoParallelMemory,
} = require("../adapters/normalize.js");

const cases = [
  ["grok", "grok", "canonical"],
  ["Grok", "grok", "canonical"],
  ["claude", "claude", "canonical"],
  ["ChatGPT", "chatgpt", "canonical"],
  ["openai", "chatgpt", "alias"],
  ["gemini", "gemini", "canonical"],
  ["bard", "gemini", "alias"],
  ["mistral", "mistral", "canonical"],
  ["", "unknown", "empty"],
  [null, "unknown", "missing"],
  ["future-ia", "future-ia", "unregistered_slug"],
];

for (const [input, expected, reason] of cases) {
  const got = normalizeSourceApplication(input);
  assert.equal(got.ok, true, `ok ${input}`);
  assert.equal(got.value, expected, `value ${input}`);
  assert.equal(got.reason, reason, `reason ${input}`);
  const bound = assertNoParallelMemory(got.value);
  assert.equal(bound.parallel_memory, false);
  assert.equal(bound.auto_approve, false);
  assert.equal(bound.canonical_write, false);
}

assert.equal(normalizeSourceApplication("!!!").ok, false);

console.log("PASS aria-adapters-v1.0.0 normalize + no-parallel-memory");
