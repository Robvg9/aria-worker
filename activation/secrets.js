'use strict';

const { isSecretRef } = require('./contract');

const DEFAULT_ENV_PREFIX = 'ARIA_SECRET_';

function envNameForRef(ref, prefix = DEFAULT_ENV_PREFIX) {
  if (!isSecretRef(ref)) return null;
  const [, provider, account] = ref.trim().match(/^secret:\/\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/) || [];
  if (!provider || !account) return null;
  const clean = value => value.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return `${prefix}${clean(provider)}_${clean(account)}`;
}

function createEnvironmentSecretResolver(env = process.env, prefix = DEFAULT_ENV_PREFIX) {
  return Object.freeze({
    resolver_id: 'environment',
    resolve(ref) {
      const name = envNameForRef(ref, prefix);
      if (!name) return { status:'unavailable', reason:'credential_ref_invalid' };
      const value = env && typeof env[name] === 'string' ? env[name] : '';
      if (!value) return { status:'unavailable', reason:'credential_unconfigured' };
      return { status:'resolved', secret:value };
    }
  });
}

module.exports = { DEFAULT_ENV_PREFIX, envNameForRef, createEnvironmentSecretResolver };
