/**
 * ARIA Adapter Layer v1.0.0 — source_application canonicalization.
 * Interface-only. Does not write memory. Does not choose a pipeline.
 */
const REGISTRY = require("./registry.json");

const CANONICAL = new Set(REGISTRY.canonical_source_applications);
const ALIASES = Object.fromEntries(
  Object.entries(REGISTRY.aliases).map(([k, v]) => [k.toLowerCase(), v])
);

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalizeSourceApplication(raw) {
  if (raw == null) {
    return { ok: true, value: "unknown", normalized: true, reason: "missing" };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { ok: true, value: "unknown", normalized: true, reason: "empty" };
  }
  const key = trimmed.toLowerCase();
  if (CANONICAL.has(key)) {
    return {
      ok: true,
      value: key,
      normalized: key !== trimmed,
      reason: "canonical",
    };
  }
  if (ALIASES[key]) {
    return {
      ok: true,
      value: ALIASES[key],
      normalized: true,
      reason: "alias",
    };
  }
  if (SLUG.test(key)) {
    return {
      ok: true,
      value: key,
      normalized: key !== trimmed,
      reason: "unregistered_slug",
    };
  }
  return {
    ok: false,
    value: null,
    normalized: false,
    reason: "invalid",
  };
}

function assertNoParallelMemory(sourceApplication) {
  return {
    pipeline: "CAPTURE → GATE → COMMIT → SYNC",
    source_application: sourceApplication,
    parallel_memory: false,
    auto_approve: false,
    canonical_write: false,
  };
}

module.exports = {
  normalizeSourceApplication,
  assertNoParallelMemory,
  CANONICAL,
  ALIASES,
};
