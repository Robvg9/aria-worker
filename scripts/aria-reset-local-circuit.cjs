'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  createRemoteServiceCircuitBreaker,
  resolveDefaultStatePath
} = require('../agents/shared/remote-service-circuit-breaker.cjs');

const REQUIRED_CONFIRMATION = 'RESET_ARIA_LOCAL_CIRCUIT_ONCE';

function requiredText(value, name, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error('local_circuit_reset_' + name + '_required');
  }
  return value.trim();
}

async function appendAudit(auditPath, record) {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, JSON.stringify(record) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
}

async function resetLocalCircuit(options = {}) {
  if (options.confirm !== REQUIRED_CONFIRMATION) {
    throw new Error('local_circuit_reset_confirmation_required');
  }
  if (options.serviceRestored !== true) {
    throw new Error('local_circuit_reset_service_restored_attestation_required');
  }
  if (options.canonicalFreezeCleared !== true) {
    throw new Error('local_circuit_reset_canonical_freeze_attestation_required');
  }

  const evidenceRef = requiredText(options.evidenceRef, 'evidence_ref', 1_024);
  const operatorNote = requiredText(options.operatorNote, 'operator_note', 500);
  const statePath = path.resolve(
    typeof options.statePath === 'string' && options.statePath.trim()
      ? options.statePath.trim()
      : resolveDefaultStatePath()
  );
  const auditPath = statePath + '.reset-audit.jsonl';
  const requestedAt = new Date().toISOString();
  const auditBase = {
    at: requestedAt,
    event: 'local_circuit_reset',
    state_file: path.basename(statePath),
    evidence_ref: evidenceRef,
    operator_note: operatorNote,
    service_restored_owner_attestation: true,
    canonical_freeze_cleared_owner_attestation: true,
    confirmation: REQUIRED_CONFIRMATION
  };

  // Write the request before changing the circuit. A completed record follows
  // only after the local breaker confirms that the state was actually cleared.
  await appendAudit(auditPath, { ...auditBase, phase: 'requested' });

  const breaker = createRemoteServiceCircuitBreaker({ statePath });
  const result = await breaker.resetAfterAuthorizedRecovery({
    authorized: true,
    probe: async () => ({
      serviceRestored: true,
      canonicalFreezeCleared: true
    })
  });

  const completedAt = new Date().toISOString();
  const completedRecord = {
    ...auditBase,
    at: completedAt,
    phase: 'completed',
    cleared_paused_routes: result.cleared_paused_routes,
    reset: result.reset === true
  };

  // The circuit has already been reset if this append fails. Surface that
  // distinction rather than misreporting the reset as unsuccessful.
  try {
    await appendAudit(auditPath, completedRecord);
  } catch (error) {
    return {
      ...result,
      audit_path: auditPath,
      audit_warning: 'local_circuit_reset_completed_audit_append_failed',
      audit_error: String(error && error.message || error).slice(0, 180)
    };
  }

  return {
    ...result,
    completed_at: completedAt,
    audit_path: auditPath,
    global_402_note: 'A still-open coordinator 402 circuit can be applied again on the next sync.'
  };
}

function parseArguments(argv) {
  const parsed = {
    serviceRestored: false,
    canonicalFreezeCleared: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--service-restored') {
      parsed.serviceRestored = true;
    } else if (token === '--canonical-freeze-cleared') {
      parsed.canonicalFreezeCleared = true;
    } else if (['--confirm', '--evidence-ref', '--operator-note', '--state-path'].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('local_circuit_reset_argument_value_missing:' + token);
      index += 1;
      const key = {
        '--confirm': 'confirm',
        '--evidence-ref': 'evidenceRef',
        '--operator-note': 'operatorNote',
        '--state-path': 'statePath'
      }[token];
      parsed[key] = value;
    } else {
      throw new Error('local_circuit_reset_argument_not_allowed:' + String(token).slice(0, 80));
    }
  }
  return parsed;
}

async function main() {
  const result = await resetLocalCircuit(parseArguments(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write('LOCAL_CIRCUIT_RESET_BLOCKED: ' + String(error && error.message || error) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_CONFIRMATION,
  parseArguments,
  resetLocalCircuit
};
