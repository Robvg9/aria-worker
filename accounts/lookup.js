/**
 * ARIA Account Manager lookup helpers (declarative)
 * Mission 10.4 — pure functions, no side effects, no secrets, no routing.
 */
const registry = require('./registry.json');

const ACTIVE_STATUS = 'active';

function getAccount(accountId) {
  if (!accountId || typeof accountId !== 'string') return null;
  return registry.accounts.find(a => a.account_id === accountId) || null;
}

function accountsForProvider(providerId) {
  if (!providerId || typeof providerId !== 'string') return [];
  return registry.accounts.filter(a => a.provider_id === providerId);
}

function isActiveStatus(account) {
  if (!account || typeof account !== 'object') return false;
  return account.status === ACTIVE_STATUS;
}

function isAccountActive(accountId) {
  return isActiveStatus(getAccount(accountId));
}

function listAccountIds() {
  return registry.accounts.map(a => a.account_id);
}

function modelsOfAccount(accountId) {
  const a = getAccount(accountId);
  if (!a || !Array.isArray(a.model_refs)) return [];
  return a.model_refs.slice();
}

function credentialRefOf(accountId) {
  const a = getAccount(accountId);
  return a ? a.credential_ref : null;
}

module.exports = {
  version: registry.version,
  getAccount,
  accountsForProvider,
  isAccountActive,
  isActiveStatus,
  listAccountIds,
  modelsOfAccount,
  credentialRefOf,
  registry
};
