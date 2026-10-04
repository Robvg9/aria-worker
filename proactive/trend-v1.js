'use strict';

const crypto = require('node:crypto');

const VERSION = 'aria-proactive-trend-intelligence-v1.0.0';
const ACTION_MODE = 'recommendation_only';

function canonical(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function sha256(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function normalizePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function recommendationKey(item) {
  return [
    String(item?.kind || 'unknown'),
    String(item?.fingerprint || item?.id || 'unknown')
  ].join('|');
}

function collectObservations(digests) {
  const map = new Map();
  for (const digest of Array.isArray(digests) ? digests : []) {
    const observed = normalizeTimestamp(digest?.observed_at || digest?.generated_at);
    const digestId = String(digest?.digest_id || digest?.id || '');
    if (!digestId || observed === null) continue;
    const recommendations = Array.isArray(digest?.recommendations)
      ? digest.recommendations
      : Array.isArray(digest?.digest?.recommendations)
        ? digest.digest.recommendations
        : [];

    const seenInDigest = new Set();
    for (const rec of recommendations) {
      const key = recommendationKey(rec);
      if (seenInDigest.has(key)) continue;
      seenInDigest.add(key);
      const entry = map.get(key) || {
        kind: String(rec?.kind || 'unknown'),
        fingerprint: String(rec?.fingerprint || ''),
        id: String(rec?.id || ''),
        occurrences: 0,
        first_observed_at: observed,
        last_observed_at: observed,
        digest_ids: []
      };
      entry.occurrences += 1;
      entry.first_observed_at = Math.min(entry.first_observed_at, observed);
      entry.last_observed_at = Math.max(entry.last_observed_at, observed);
      entry.digest_ids.push(digestId);
      map.set(key, entry);
    }
  }
  return [...map.values()];
}

function classify(entry, { minOccurrences }) {
  if (entry.occurrences >= minOccurrences) return 'persistent';
  if (entry.occurrences >= 2) return 'recurring';
  return 'new';
}

function buildTrendDigest(digests, options = {}) {
  const maxAgeMs = Math.max(1000, Number(options.maxAgeMs ?? 7 * 86400000));
  const minOccurrences = normalizePositiveInt(options.minOccurrences, 2);
  const nowMs = normalizeTimestamp(options.now) ?? Date.now();
  const cutoff = nowMs - maxAgeMs;

  const usable = (Array.isArray(digests) ? digests : [])
    .filter((item) => {
      const observed = normalizeTimestamp(item?.observed_at || item?.generated_at);
      return observed !== null && observed >= cutoff && observed <= nowMs;
    })
    .sort((a, b) =>
      normalizeTimestamp(a?.observed_at || a?.generated_at) - normalizeTimestamp(b?.observed_at || b?.generated_at)
      || String(a?.digest_id || a?.id || '').localeCompare(String(b?.digest_id || b?.id || ''))
    );

  const observations = collectObservations(usable).map((entry) => ({
    ...entry,
    state: classify(entry, { minOccurrences }),
    span_ms: entry.last_observed_at - entry.first_observed_at,
    digest_ids: [...new Set(entry.digest_ids)].sort()
  }));

  observations.sort((a, b) =>
    String(a.kind).localeCompare(String(b.kind))
    || String(a.fingerprint).localeCompare(String(b.fingerprint))
    || String(a.id).localeCompare(String(b.id))
  );

  const trends = observations.map((entry) => Object.freeze({
    trend_id: 'trend_' + sha256({
      version: VERSION,
      kind: entry.kind,
      fingerprint: entry.fingerprint,
      digest_ids: entry.digest_ids
    }).slice(0, 24),
    version: VERSION,
    action_mode: ACTION_MODE,
    kind: 'recommendation_trend',
    state: entry.state,
    recommendation_kind: entry.kind,
    recommendation_fingerprint: entry.fingerprint,
    recommendation_id: entry.id,
    occurrence_count: entry.occurrences,
    first_observed_at: new Date(entry.first_observed_at).toISOString(),
    last_observed_at: new Date(entry.last_observed_at).toISOString(),
    span_ms: entry.span_ms,
    digest_ids: Object.freeze(entry.digest_ids)
  }));

  const fingerprint = sha256({
    version: VERSION,
    action_mode: ACTION_MODE,
    now_ms: nowMs,
    max_age_ms: maxAgeMs,
    min_occurrences: minOccurrences,
    digests: usable.map((item) => ({
      digest_id: String(item.digest_id || item.id || ''),
      observed_at: new Date(normalizeTimestamp(item.observed_at || item.generated_at)).toISOString(),
      recommendations: (Array.isArray(item.recommendations)
        ? item.recommendations
        : Array.isArray(item?.digest?.recommendations) ? item.digest.recommendations : []
      ).map((rec) => ({
        kind: String(rec?.kind || 'unknown'),
        fingerprint: String(rec?.fingerprint || ''),
        id: String(rec?.id || '')
      }))
    }))
  });

  return Object.freeze({
    version: VERSION,
    action_mode: ACTION_MODE,
    generated_at: new Date(nowMs).toISOString(),
    window_start: new Date(cutoff).toISOString(),
    window_end: new Date(nowMs).toISOString(),
    input_digest_count: usable.length,
    trend_count: trends.length,
    persistent_count: trends.filter((x) => x.state === 'persistent').length,
    recurring_count: trends.filter((x) => x.state === 'recurring').length,
    new_count: trends.filter((x) => x.state === 'new').length,
    fingerprint,
    trends: Object.freeze(trends)
  });
}

module.exports = Object.freeze({
  VERSION,
  ACTION_MODE,
  canonical,
  sha256,
  buildTrendDigest
});
