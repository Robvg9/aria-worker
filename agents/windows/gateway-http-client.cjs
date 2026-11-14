'use strict';

function createGatewayRequest({
  https,
  lookup,
  defaultTimeoutMs = 15_000,
  maxResponseBytes = 1_048_576
} = {}) {
  if (!https || typeof https.request !== 'function') throw new TypeError('https.request is required');
  if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) throw new TypeError('defaultTimeoutMs must be positive');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError('maxResponseBytes must be a positive integer');

  return function nativeGatewayRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let response = null;
      let responseText = '';
      let responseBytes = 0;
      let deadline = null;
      let request = null;
      const startedAt = Date.now();
      let phase = 'request_setup';
      let phaseStartedAt = startedAt;
      let socketReused = null;
      const phaseHistory = [];

      const transition = nextPhase => {
        if (nextPhase === phase) return;
        const now = Date.now();
        phaseHistory.push({ phase, duration_ms: Math.max(0, now - phaseStartedAt) });
        phase = nextPhase;
        phaseStartedAt = now;
      };

      const diagnostics = () => ({
        phase,
        elapsed_ms: Math.max(0, Date.now() - startedAt),
        socket_reused: socketReused,
        phase_history: phaseHistory.slice(-8)
      });

      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        if (error) {
          if (error && typeof error === 'object') {
            if (typeof error.phase !== 'string') Object.assign(error, diagnostics());
          }
          reject(error);
        } else {
          resolve(value);
        }
      };

      const gatewayError = (message, code, extra = {}) => {
        const error = new Error(message);
        error.code = code;
        Object.assign(error, diagnostics(), extra);
        return error;
      };

      try {
        const parsed = new URL(url);
        const body = typeof options.body === 'string' ? options.body : '';
        const requestTimeoutMs = Math.max(1_000, Number(options.timeoutMs) || defaultTimeoutMs);

        request = https.request({
          hostname: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'http:' ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method: options.method || 'GET',
          ...(lookup ? { lookup } : {}),
          family: options.family || 4,
          headers: {
            ...(options.headers || {}),
            ...(body ? { 'content-length': Buffer.byteLength(body) } : {})
          }
        }, incoming => {
          response = incoming;
          transition('response_body');
          incoming.setEncoding('utf8');

          incoming.on('data', chunk => {
            if (settled) return;
            responseBytes += Buffer.byteLength(chunk);
            if (responseBytes > maxResponseBytes) {
              const error = gatewayError('gateway_response_too_large', 'gateway_response_too_large');
              request.destroy(error);
              settle(error);
              return;
            }
            responseText += chunk;
          });

          incoming.once('aborted', () => {
            settle(gatewayError('gateway_response_aborted', 'gateway_response_aborted'));
          });

          incoming.once('error', error => settle(error));

          incoming.once('end', () => {
            if (!incoming.complete) {
              settle(gatewayError('gateway_response_incomplete', 'gateway_response_incomplete'));
              return;
            }
            transition('complete');
            settle(null, {
              status: Number(incoming.statusCode || 0),
              text: responseText,
              diagnostics: diagnostics()
            });
          });

          incoming.once('close', () => {
            if (!incoming.complete) {
              settle(gatewayError('gateway_response_incomplete', 'gateway_response_incomplete'));
            }
          });
        });

        request.once('socket', socket => {
          socketReused = !socket.connecting;
          if (socketReused) {
            transition('awaiting_response_headers');
            return;
          }

          transition('dns_lookup');
          socket.once('lookup', error => {
            transition(error ? 'dns_lookup_failed' : 'tcp_connect');
          });
          socket.once('connect', () => {
            transition(parsed.protocol === 'https:' ? 'tls_handshake' : 'awaiting_response_headers');
          });
          if (parsed.protocol === 'https:') {
            socket.once('secureConnect', () => transition('awaiting_response_headers'));
          }
        });

        // This is a hard deadline, not an inactivity timer. It remains armed
        // until the whole response settles, including its body.
        deadline = setTimeout(() => {
          const error = gatewayError('gateway_timeout', 'gateway_timeout', {
            timeout_kind: 'hard_deadline'
          });
          request.destroy(error);
          settle(error);
        }, requestTimeoutMs);
        if (typeof deadline.unref === 'function') deadline.unref();

        request.setTimeout(requestTimeoutMs, () => {
          const error = gatewayError('gateway_timeout', 'gateway_timeout', {
            timeout_kind: 'socket_inactivity'
          });
          request.destroy(error);
          settle(error);
        });

        request.once('error', error => settle(error));

        if (body) request.write(body);
        request.end();
      } catch (error) {
        settle(error);
      }
    });
  };
}

module.exports = { createGatewayRequest };
