'use strict';

const os = require('node:os');
const MIN_LOCAL_LLM_RAM_BYTES = 8 * 1024 ** 3;
const MIN_LOCAL_LLM_LOGICAL_CPUS = 4;

function getWindowsResourceProfile({
  totalMemoryBytes = os.totalmem(),
  logicalCpus = os.cpus().length,
} = {}) {
  const ramBytes = Number(totalMemoryBytes);
  const cpuCount = Number(logicalCpus);
  const ramGb = Number.isFinite(ramBytes) ? Number((ramBytes / 1024 ** 3).toFixed(2)) : 0;
  const cpus = Number.isFinite(cpuCount) ? cpuCount : 0;
  const localLlmEligible = ramBytes >= MIN_LOCAL_LLM_RAM_BYTES && cpus >= MIN_LOCAL_LLM_LOGICAL_CPUS;
  return {
    profile: localLlmEligible ? 'standard' : 'worker-light',
    ram_gb: ramGb,
    logical_cpus: cpus,
    local_llm_eligible: localLlmEligible,
    guard_reason: localLlmEligible
      ? 'eligible'
      : 'requires_at_least_8gb_ram_and_4_logical_cpus:ram=' + ramGb + 'gb,cpus=' + cpus,
  };
}

module.exports = {
  MIN_LOCAL_LLM_RAM_BYTES,
  MIN_LOCAL_LLM_LOGICAL_CPUS,
  getWindowsResourceProfile,
};
