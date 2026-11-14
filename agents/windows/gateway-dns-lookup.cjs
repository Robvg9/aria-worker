'use strict';

const dns = require('node:dns');

const DEFAULT_TARGET_HOSTNAME = 'icuqsstxfdbvjytkhlog.supabase.co';
const DEFAULT_FALLBACK_SERVERS = Object.freeze(['1.1.1.1', '8.8.8.8']);

function createFallbackResolver(servers = DEFAULT_FALLBACK_SERVERS) {
  const resolver = new dns.Resolver({ timeout: 1500, tries: 1 });
  resolver.setServers([...servers]);
  return resolver;
}

function createGatewayLookup({
  targetHostname = DEFAULT_TARGET_HOSTNAME,
  systemLookup = dns.lookup,
  resolver = createFallbackResolver(),
  fallbackServers = DEFAULT_FALLBACK_SERVERS,
  onFallbackStart = () => {},
  onFallbackResult = () => {}
} = {}) {
  if (typeof systemLookup !== 'function') throw new TypeError('systemLookup must be a function');
  if (!resolver || typeof resolver.resolve4 !== 'function') throw new TypeError('resolver must expose resolve4');
  if (typeof onFallbackStart !== 'function' || typeof onFallbackResult !== 'function') {
    throw new TypeError('DNS fallback callbacks must be functions');
  }

  const expectedHost = String(targetHostname).toLowerCase();
  const servers = [...fallbackServers];

  return function gatewayLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (typeof callback !== 'function') throw new TypeError('lookup callback is required');

    const normalized = typeof options === 'number' ? { family: options } : (options || {});
    let settled = false;
    const finish = (...args) => {
      if (settled) return;
      settled = true;
      callback(...args);
    };

    systemLookup(hostname, options, (systemError, address, family) => {
      if (!systemError) {
        if (normalized.all) return finish(null, address);
        return finish(null, address, family);
      }

      const hostMatches = typeof hostname === 'string' && hostname.toLowerCase() === expectedHost;
      const retryable = ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEOUT'].includes(systemError.code);
      if (!hostMatches || !retryable) return finish(systemError);

      const recordFamily = normalized.family === 6 ? 6 : 4;
      const methodName = recordFamily === 6 ? 'resolve6' : 'resolve4';
      const resolve = resolver[methodName];
      if (typeof resolve !== 'function') return finish(systemError);

      try {
        onFallbackStart({
          hostname,
          systemErrorCode: systemError.code,
          family: recordFamily,
          servers
        });
      } catch {
        // Observability must not block DNS recovery.
      }

      resolve.call(resolver, hostname, (fallbackError, addresses) => {
        if (fallbackError || !Array.isArray(addresses) || addresses.length === 0) {
          try {
            onFallbackResult({
              hostname,
              status: 'failed',
              family: recordFamily,
              errorCode: fallbackError?.code || 'empty_dns_answer'
            });
          } catch {
            // Observability must not block DNS recovery.
          }
          return finish(systemError);
        }

        const resolved = addresses.map(value => ({
          address: String(value),
          family: recordFamily
        }));

        try {
          onFallbackResult({
            hostname,
            status: 'succeeded',
            family: recordFamily,
            addressCount: resolved.length,
            servers
          });
        } catch {
          // Observability must not block DNS recovery.
        }

        if (normalized.all) return finish(null, resolved);
        return finish(null, resolved[0].address, resolved[0].family);
      });
    });
  };
}

module.exports = {
  createGatewayLookup,
  createFallbackResolver,
  DEFAULT_TARGET_HOSTNAME,
  DEFAULT_FALLBACK_SERVERS
};
