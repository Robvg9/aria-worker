'use strict';

const ALLOWED_PHASES = Object.freeze([
  'inspect',
  'plan',
  'branch_sandbox',
  'modify',
  'regression',
  'evaluate'
]);

const READ_OPERATIONS = new Set(['repo_read', 'file_read', 'dependency_map']);
const MODIFY_OPERATIONS = new Set(['branch_create', 'file_write']);
const VERIFY_OPERATIONS = new Set(['test_execute', 'evaluate_change']);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function normalizeRepo(repo) {
  if (typeof repo !== 'string' || !/^[-A-Za-z0-9_.]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    fail('invalid_repository', 'repository must use owner/name');
  }
  return repo;
}

function normalizeSandboxBranch(branch) {
  if (typeof branch !== 'string' || !branch.trim()) fail('sandbox_branch_required', 'sandbox branch required');
  const value = branch.trim();
  if (value === 'main' || value.startsWith('main/')) fail('main_branch_forbidden', 'main branch is never writable by BC-4');
  if (!value.startsWith('aria/sandbox/')) fail('invalid_sandbox_branch', 'sandbox branch must start with aria/sandbox/');
  return value;
}

function assertPhase(phase) {
  if (!ALLOWED_PHASES.includes(phase)) fail('invalid_phase', `unsupported phase: ${phase}`);
}

function validateStep({ phase, operation, repo, branch = null } = {}) {
  assertPhase(phase);
  normalizeRepo(repo);

  if (phase === 'inspect' || phase === 'plan') {
    if (!READ_OPERATIONS.has(operation)) fail('operation_not_allowed', `operation ${operation} is not allowed during ${phase}`);
    return Object.freeze({ phase, operation, mode: 'read_only', repository: repo, branch });
  }

  if (phase === 'branch_sandbox') {
    if (operation !== 'branch_create') fail('branch_phase_requires_branch_create', 'branch_sandbox only permits branch_create');
    normalizeSandboxBranch(branch);
    return Object.freeze({ phase, operation, mode: 'sandbox_write', repository: repo, branch });
  }

  if (phase === 'modify') {
    if (!MODIFY_OPERATIONS.has(operation) || operation === 'branch_create') fail('modify_operation_not_allowed', `operation ${operation} is not allowed during modify`);
    normalizeSandboxBranch(branch);
    return Object.freeze({ phase, operation, mode: 'sandbox_write', repository: repo, branch });
  }

  if (phase === 'regression' || phase === 'evaluate') {
    if (!VERIFY_OPERATIONS.has(operation)) fail('verification_operation_not_allowed', `operation ${operation} is not allowed during ${phase}`);
    normalizeSandboxBranch(branch);
    return Object.freeze({ phase, operation, mode: 'verification', repository: repo, branch });
  }

  fail('unreachable_phase', 'phase validator reached an impossible state');
}

function buildSandboxPlan({ repository = 'Robvg9/battlecruiser', sandboxBranch, files = [] } = {}) {
  const repo = normalizeRepo(repository);
  const branch = normalizeSandboxBranch(sandboxBranch);
  if (!Array.isArray(files)) fail('invalid_files', 'files must be an array');
  const normalizedFiles = files.map(file => {
    if (typeof file !== 'string' || !file.trim()) fail('invalid_file', 'file path must be a non-empty string');
    const path = file.trim();
    if (path.startsWith('/') || path.includes('..')) fail('unsafe_file_path', `unsafe file path: ${path}`);
    return path;
  });

  return Object.freeze([
    validateStep({ phase: 'inspect', operation: 'repo_read', repo, branch: null }),
    validateStep({ phase: 'plan', operation: 'file_read', repo, branch: null }),
    validateStep({ phase: 'branch_sandbox', operation: 'branch_create', repo, branch }),
    ...normalizedFiles.map(() => validateStep({ phase: 'modify', operation: 'file_write', repo, branch })),
    validateStep({ phase: 'regression', operation: 'test_execute', repo, branch }),
    validateStep({ phase: 'evaluate', operation: 'evaluate_change', repo, branch })
  ]);
}

module.exports = Object.freeze({
  ALLOWED_PHASES,
  validateStep,
  buildSandboxPlan,
  normalizeSandboxBranch,
  normalizeRepo
});
