'use strict';

const RANK = Object.freeze({ read: 0, low_risk_write: 1, high_risk_write: 2, destructive: 3, unknown: 99 });

function createPermissionResolver({ policy = {}, approvalStore = null } = {}) {
  function riskAllowed(tool, requestedRisk) {
    if (!tool || typeof requestedRisk !== 'string') return false;
    if (tool.risk_level === 'unknown') return false;
    if (!Object.prototype.hasOwnProperty.call(RANK, requestedRisk)) return false;
    return RANK[tool.risk_level] <= RANK[requestedRisk];
  }

  async function resolve({ tool, operation, requestedRisk = null, requestId = null, executionId = null } = {}) {
    if (!tool || tool.status !== 'available') return { status: 'blocked', reason: 'tool_unavailable' };
    if (!Array.isArray(tool.operations) || !tool.operations.includes(operation)) return { status: 'blocked', reason: 'operation_unsupported' };
    const risk = requestedRisk || tool.risk_level;
    if (!riskAllowed(tool, risk)) return { status: 'blocked', reason: 'risk_mismatch' };
    const requiresHuman = risk === 'high_risk_write' || risk === 'destructive';
    if (!requiresHuman) return { status: 'approved', requires_human: false, request_id: requestId, execution_id: executionId };
    if (!approvalStore || typeof approvalStore.getApproval !== 'function') return { status: 'blocked', reason: 'approval_store_unavailable' };
    const approval = await approvalStore.getApproval({ request_id: requestId, execution_id: executionId, tool_id: tool.tool_id, operation, risk_level: risk });
    if (!approval || approval.status !== 'approved') return { status: 'blocked', reason: 'human_approval_required' };
    return { status: 'approved', requires_human: true, request_id: requestId, execution_id: executionId };
  }

  return Object.freeze({ resolve, riskRank: (risk) => RANK[risk] ?? RANK.unknown, policy });
}

module.exports = { createPermissionResolver };
