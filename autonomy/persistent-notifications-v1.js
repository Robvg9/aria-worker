'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isoNow = () => new Date().toISOString();

function createPersistentNotifier({ directory, webhookUrl = process.env.ARIA_NOTIFICATION_WEBHOOK_URL, token = process.env.ARIA_NOTIFICATION_TOKEN, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('directory_required');
  const root = path.resolve(directory);
  const outbox = path.join(root, 'notifications');
  let stopped = false;
  let runner = null;
  let flushLock = Promise.resolve();
  let endpoint = null;
  if (webhookUrl) {
    endpoint = new URL(webhookUrl);
    if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
      throw new Error('notification_webhook_must_use_https');
    }
  }

  async function ensure() { await fs.mkdir(outbox, { recursive: true }); }
  function fileFor(notificationId) {
    if (!/^notification_[a-zA-Z0-9_-]{1,160}$/.test(String(notificationId))) throw new Error('invalid_notification_id');
    return path.join(outbox, notificationId + '.json');
  }
  async function save(record) {
    await ensure();
    const file = fileFor(record.notification_id);
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
    return clone(record);
  }
  async function list() {
    await ensure();
    const files = (await fs.readdir(outbox)).filter(name => name.endsWith('.json'));
    const records = await Promise.all(files.map(async name => JSON.parse(await fs.readFile(path.join(outbox, name), 'utf8'))));
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  function safePayload(record) {
    const event = record.event || {};
    return {
      source: 'ARIA Mission Control',
      notification_id: record.notification_id,
      type: String(event.type || 'aria_event'),
      mission_id: event.mission_id ? String(event.mission_id) : null,
      task_id: event.task_id ? String(event.task_id) : null,
      approval_id: event.approval_id ? String(event.approval_id) : null,
      reason: event.reason ? String(event.reason).slice(0, 1000) : null,
      details: event.details ? String(event.details).slice(0, 1000) : null,
      created_at: record.created_at
    };
  }
  async function deliver(record) {
    if (!endpoint) {
      record.status = 'waiting_config';
      record.last_error = 'notification_webhook_not_configured';
      record.updated_at = isoNow();
      return save(record);
    }
    record.attempts = (record.attempts || 0) + 1;
    record.updated_at = isoNow();
    try {
      const headers = { 'content-type': 'application/json' };
      if (token) headers.authorization = 'Bearer ' + token;
      const response = await fetchImpl(endpoint.toString(), {
        method: 'POST', headers, body: JSON.stringify(safePayload(record)),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error('webhook_http_' + response.status);
      record.status = 'delivered';
      record.delivered_at = isoNow();
      record.last_error = null;
    } catch (error) {
      record.status = 'pending';
      record.last_error = String(error && error.message || error).slice(0, 1000);
    }
    return save(record);
  }
  async function notify(event) {
    const record = {
      notification_id: 'notification_' + crypto.randomUUID(),
      created_at: isoNow(), updated_at: isoNow(), status: endpoint ? 'pending' : 'waiting_config',
      attempts: 0, delivered_at: null, last_error: endpoint ? null : 'notification_webhook_not_configured',
      event: clone(event || {})
    };
    await save(record);
    if (endpoint) return deliver(record);
    return clone(record);
  }
  async function flush() {
    const operation = flushLock.catch(() => {}).then(async () => {
      const records = await list();
      const pending = records.filter(record => record.status === 'pending' || (endpoint && record.status === 'waiting_config'));
      const results = [];
      for (const record of pending) results.push(await deliver(record));
      return results;
    });
    flushLock = operation;
    return operation;
  }
  async function run(intervalMs = 5000) {
    if (runner) return runner;
    stopped = false;
    runner = (async () => {
      while (!stopped) {
        try { await flush(); } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, intervalMs)));
      }
    })();
    return runner;
  }
  async function stop() {
    stopped = true;
    if (runner) await Promise.race([runner, new Promise(resolve => setTimeout(resolve, 1200))]);
    runner = null;
  }
  return Object.freeze({ notify, list, flush, run, stop, configured: Boolean(endpoint) });
}

module.exports = Object.freeze({ createPersistentNotifier });
