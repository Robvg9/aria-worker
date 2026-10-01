/**
 * Forensic Continuity structural fixes for mission-runner-v22.
 * - Planner timeout via AbortController
 * - Device operation from step (allowlist)
 * - Cloudflare governed read ops
 * - Strict Computer Use enqueue payload normalization by executor contract
 */
export const PLANNER_TIMEOUT_MS = 45_000;
export const DEVICE_OPS_ALLOWLIST = new Set(["shell.execute", "computer.use", "computer.use.autonomous", "computer.use.android"]);

export async function createPlanWithTimeout(
  plannerUrl: string,
  goal: string,
  context: unknown,
  headers: Record<string, string>,
): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS);
  try {
    const response = await fetch(plannerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ goal, context }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok || !Array.isArray(body.plan?.steps)) {
      throw new Error(`planner_${response.status}`);
    }
    return body.plan.steps;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("planner_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildDeviceEnqueuePayload(
  V: string,
  missionId: string,
  step: any,
  jobId: string,
): Record<string, unknown> {
  const operation = String(step.operation || "shell.execute");
  if (!DEVICE_OPS_ALLOWLIST.has(operation)) {
    throw new Error(`device_operation_not_allowed:${operation}`);
  }
  const payload: Record<string, unknown> = {
    action: "enqueue_device_job",
    job_id: jobId,
    mission_id: missionId,
    device_id: step.target.device_id,
    operation,
    timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 30000,
    policy: step.policy || {},
    metadata: { runner: V, executor_type: "device", idempotency_key: jobId, operation },
  };
  if (operation === "shell.execute") {
    payload.command = String(step.input?.command || "echo ARIA_UO_LIVE");
    payload.cwd = typeof step.input?.cwd === "string" ? step.input.cwd : null;
  } else if (operation === "computer.use" || operation === "computer.use.autonomous" || operation === "computer.use.android") {
    // The runtime gateway persists device payloads in execution_jobs.command.
    // Each device contract is strict, so never forward arbitrary planner fields.
    if (operation === "computer.use.autonomous") {
      const source = step.input && typeof step.input === "object" ? step.input : {};
      const input: Record<string, unknown> = {};
      for (const key of ["goal", "mode", "start_url", "max_actions", "max_runtime_ms", "capture_screenshots"] as const) {
        const value = source[key];
        if (value === null || value === undefined) continue;
        if (key === "start_url") {
          if (typeof value !== "string" || value.trim() === "") continue;
          input[key] = value.trim();
          continue;
        }
        input[key] = value;
      }
      payload.command = JSON.stringify(input);
    } else {
      const input = step.input && typeof step.input === "object" ? { ...step.input } : {};

      // Android observe historically appeared as { action: "observe" } while the
      // governed DB contract expects { operation: "observe" }. Normalize the
      // shorthand at the executor boundary so planners/missions cannot disagree.
      if (
        operation === "computer.use.android" &&
        input.operation === undefined &&
        input.action === "observe"
      ) {
        delete input.action;
        input.operation = "observe";
      }
      payload.command = JSON.stringify(input);
    }
  }
  return payload;
}

export async function cloudflareConnectorExecute(
  V: string,
  SECRET: string,
  operation: string,
): Promise<Record<string, unknown>> {
  const cfReadOps = new Set(["health", "account_read", "worker_read", "deployments_read", "deployment_read", "content_read"]);
  if (!cfReadOps.has(operation)) throw new Error(`connector_operation_not_allowed:cloudflare:${operation}`);
  const base = "https://aria.robvg9.workers.dev";
  const pathMap: Record<string, string> = {
    health: "/",
    account_read: "/admin/cloudflare?op=account_read",
    worker_read: "/admin/cloudflare?op=worker_read",
    deployment_read: "/admin/cloudflare?op=deployment_read",
    deployments_read: "/admin/cloudflare?op=deployments_read",
    content_read: "/admin/cloudflare?op=content_read",
  };
  const path = pathMap[operation] || "/";
  const response = await fetch(`${base}${path}`, {
    headers: {
      "user-agent": `${V}-connector-probe`,
      "x-aria-internal-auth": SECRET || "none",
      "x-aria-operation": operation,
    },
  });
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 4000) }; }
  if (!response.ok) {
    return {
      status: "failed",
      executor_type: "connector",
      connector_id: "cloudflare",
      operation,
      http_status: response.status,
      error: { code: `cloudflare_http_${response.status}`, message: String((data as any)?.error || text.slice(0, 500)) },
      data,
    };
  }
  return {
    status: "succeeded",
    executor_type: "connector",
    connector_id: "cloudflare",
    operation,
    http_status: response.status,
    data,
    metadata: { probe_path: path, runner: V },
  };
}
