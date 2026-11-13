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

      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        if (error) reject(error);
        else resolve(value);
      };

      const gatewayError = (message, code) => {
        const error = new Error(message);
        error.code = code;
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
          ...(options.family ? { family: options.family } : {}),
          headers: {
            ...(options.headers || {}),
            ...(body ? { 'content-length': Buffer.byteLength(body) } : {})
          }
        }, incoming => {
          response = incoming;
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
            settle(null, { status: Number(incoming.statusCode || 0), text: responseText });
          });

          incoming.once('close', () => {
            if (!incoming.complete) {
              settle(gatewayError('gateway_response_incomplete', 'gateway_response_incomplete'));
            }
          });
        });

        // This is a hard deadline, not an inactivity timer. It remains armed
        // until the whole response settles, including its body.
        deadline = setTimeout(() => {
          const error = gatewayError('gateway_timeout', 'gateway_timeout');
          request.destroy(error);
          settle(error);
        }, requestTimeoutMs);
        if (typeof deadline.unref === 'function') deadline.unref();

        request.setTimeout(requestTimeoutMs, () => {
          const error = gatewayError('gateway_timeout', 'gateway_timeout');
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
