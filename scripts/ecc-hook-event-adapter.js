'use strict';

const crypto = require('node:crypto');

const SOURCES = Object.freeze({
  metadata: {
    path: 'hooks/hooks.metadata.json',
    sha: 'c5986e44c96a474b3b61e36c66a2101ffc7595b7',
  },
  hooks: {
    path: 'hooks/hooks.json',
    sha: 'ea3960496841f687d7ec03366de3ef70c32c5d4a',
  },
  codex: {
    path: 'hooks/codex-hooks.json',
    sha: '551f7a4b4732e95937af538cc97d92f7b5d76511',
  },
});

const BLOCK_KEYWORDS = /block|gate|guard|reject|protect/i;
const OBSERVE_KEYWORDS = /capture|track|observe|telemetry|notify|record/i;

function eventMode(entry) {
  const text = [entry.id, entry.description].filter(Boolean).join(' ');
  if (BLOCK_KEYWORDS.test(text)) return 'GUARD';
  if (OBSERVE_KEYWORDS.test(text)) return 'OBSERVE';
  return 'ADVISORY';
}

function buildHookEventAdapter(metadata, provenance = SOURCES) {
  if (!metadata || typeof metadata.entries !== 'object') {
    throw new Error('ECC hooks metadata has no entries');
  }

  const events = Object.entries(metadata.entries)
    .flatMap(([lifecycle, entries]) => {
      if (!Array.isArray(entries)) throw new Error(`Invalid hook lifecycle: ${lifecycle}`);
      return entries.map(entry => ({
        lifecycle,
        hook_id: entry.id,
        description: entry.description || null,
        fingerprint: entry.fingerprint || null,
        mode: eventMode(entry),
        enabled: false,
        approval_required: true,
        execution_status: 'NOT_REGISTERED',
        handler: null,
      }));
    })
    .sort((a, b) => a.hook_id.localeCompare(b.hook_id));

  const canonical = {
    schema: 'aria.ecc-hook-event-adapter.v1',
    deterministic: true,
    source: {
      repository: 'https://github.com/affaan-m/ECC',
      tag: 'v2.2.3',
      commit_sha: 'c05b2d6614f62f6db0047669aa4eefb223d478f9',
      files: provenance,
    },
    policy: {
      default_enabled: false,
      approval_required: true,
      arbitrary_command_execution: false,
      handler_registration: 'ARIA_CONTROLLED',
      auto_activation: false,
    },
    events,
  };

  const digest = crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
  return {
    ...canonical,
    adapter_digest_sha256: digest,
    summary: {
      total_events: events.length,
      guard_events: events.filter(x => x.mode === 'GUARD').length,
      observe_events: events.filter(x => x.mode === 'OBSERVE').length,
      advisory_events: events.filter(x => x.mode === 'ADVISORY').length,
      enabled: 0,
    },
  };
}

async function fetchLockedHookFile({ fetchImpl = globalThis.fetch, path, sha }) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const url = `https://api.github.com/repos/affaan-m/ECC/contents/${path}?ref=c05b2d6614f62f6db0047669aa4eefb223d478f9`;
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'aria-ecc-hook-adapter',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`ECC hook fetch failed: ${response.status}`);
  const payload = await response.json();
  if (payload.sha !== sha) throw new Error(`ECC hook SHA mismatch for ${path}`);
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') throw new Error(`ECC hook content unavailable for ${path}`);
  return JSON.parse(Buffer.from(payload.content.replace(/\n/g, ''), 'base64').toString('utf8'));
}

async function buildLiveHookAdapter({ fetchImpl = globalThis.fetch } = {}) {
  const metadata = await fetchLockedHookFile({ fetchImpl, ...SOURCES.metadata });
  const adapter = buildHookEventAdapter(metadata);
  await fetchLockedHookFile({ fetchImpl, ...SOURCES.hooks });
  await fetchLockedHookFile({ fetchImpl, ...SOURCES.codex });
  return adapter;
}

module.exports = {
  SOURCES,
  eventMode,
  buildHookEventAdapter,
  fetchLockedHookFile,
  buildLiveHookAdapter,
};
