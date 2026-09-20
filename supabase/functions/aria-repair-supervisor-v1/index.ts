import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const GITHUB = `${URL}/functions/v1/aria-github-app-runtime-v1`;
const CANONICAL = `${URL}/functions/v1/aria-canonical-runtime-v1`;
const WORKER = "aria-repair-supervisor-v1";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const equal = (a: string, b: string) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function authorized(req: Request) {
  const token = bearer(req);
  if (token && SECRET && equal(token, SECRET)) return true;
  const cron = req.headers.get("x-aria-autonomy-token");
  if (!cron) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: cron });
  return !error && data === true;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(`${name}:${error.message}`);
  return data;
}

async function github(operation: string, args: Record<string, unknown>) {
  const response = await fetch(GITHUB, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ operation, owner: "Robvg9", repo: "aria-worker", ...args }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.error ?? `github_runtime_${response.status}`));
  return body.data ?? null;
}

function safeBranch(missionId: string) {
  return `aria/repair/${String(missionId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}`;
}

function missionStep(mission: any) {
  const plan = Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : [];
  const failedId = String(mission?.checkpoint?.recovery?.failed_step_id ?? "");
  return plan.find((x: any) => String(x?.id) === failedId) ?? plan[0] ?? null;
}

function autoMergeAllowed(mission: any, step: any) {
  const risk = String(step?.risk ?? "").toUpperCase();
  const policy = step?.policy ?? {};
  const explicitGate = mission?.metadata?.human_gate_required;
  return risk === "LOW_RISK_WRITE"
    && policy?.auto_merge_low_risk === true
    && policy?.production_merge_requires_human_gate !== true
    && policy?.human_gate_required !== true
    && !(Array.isArray(explicitGate) && explicitGate.length)
    && explicitGate !== true;
}

function changedNeedsMainVerification(files: any[]) {
  return files.some((f: any) => {
    const p = String(f?.filename ?? "");
    return /^supabase\/functions\//.test(p)
      || /^supabase\/migrations\//.test(p)
      || /^autonomy\//.test(p)
      || /^agents\//.test(p)
      || /^android-ui-agent\//.test(p)
      || /^pwa\//.test(p)
      || /^\.github\/workflows\//.test(p);
  });
}

async function ensureQueuedMissions() {
  const { data: devices, error: deviceError } = await sb.schema("aria_internal").from("device_registry")
    .select("device_id,agent_type,status,last_seen_at")
    .eq("agent_type", "android-termux")
    .eq("status", "online")
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (deviceError) throw new Error(deviceError.message);
  const device = devices?.[0];
  if (!device?.device_id) return { status: "awaiting_device", queued: 0 };

  const { data: missions, error: missionError } = await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,goal,status,metadata,created_at,updated_at")
    .eq("status", "queued")
    .contains("metadata", { autonomy_managed: true })
    .order("created_at", { ascending: true })
    .limit(20);
  if (missionError) throw new Error(missionError.message);

  let queued = 0;
  let skipped = 0;
  for (const mission of missions ?? []) {
    const source = String(mission?.metadata?.goal_source ?? mission?.metadata?.source ?? "").toLowerCase();
    if (!(source.includes("chat") || source.includes("user") || source.includes("direct"))) {
      skipped++;
      continue;
    }
    const { data: existing, error: queueError } = await sb.schema("aria_internal").from("meditation_queue")
      .select("queue_id,status,resolved_mission_id")
      .eq("item_type", "mission")
      .eq("item_id", String(mission.mission_id))
      .in("status", ["queued", "running", "paused"])
      .limit(1);
    if (queueError) throw new Error(queueError.message);
    if (existing?.length) {
      skipped++;
      continue;
    }
    const { error } = await sb.rpc("meditation_queue_add", {
      p_device_id: String(device.device_id),
      p_item_type: "mission",
      p_item_id: String(mission.mission_id),
    });
    if (error) throw new Error(error.message);
    queued++;
  }
  return { status: "queued", queued, skipped, device_id: device.device_id };
}

async function updateBlocked(mission: any, patch: Record<string, unknown>) {
  const claimed = await rpc("aria_mission_claim_by_id_lease", {
    p_mission_id: mission.mission_id,
    p_worker_id: WORKER,
    p_lease_for: "00:02:00",
  });
  if (!claimed) return null;
  return rpc("aria_mission_update_lease", {
    p_mission_id: mission.mission_id,
    p_worker_id: WORKER,
    p_mission: {
      ...mission,
      ...patch,
      metadata: { ...(mission.metadata ?? {}), autonomy_managed: true },
      lease_owner: null,
      lease_until: null,
    },
  });
}

async function appendEvent(missionId: string, event_type: string, payload: Record<string, unknown>) {
  try {
    await rpc("aria_mission_append_event_lease", {
      p_mission_id: missionId,
      p_worker_id: WORKER,
      p_event: { event_type, payload },
    });
  } catch {
    // Evidence persistence is best effort here; the state machine itself remains fenced.
  }
}

async function verifyMainAfterMerge(mergeSha: string, files: any[]) {
  const runs = await github("main_workflow_runs", { commit_sha: mergeSha });
  const needs = changedNeedsMainVerification(files);
  if (!needs) return { status: "not_required", ...runs };
  if (Number(runs.total ?? 0) === 0) return { status: "awaiting_main_ci", ...runs };
  if (Number(runs.pending ?? 0) > 0) return { status: "awaiting_main_ci", ...runs };
  if (Number(runs.failed ?? 0) > 0) return { status: "main_ci_failed", ...runs };
  return { status: "verified_main_ci", ...runs };
}

async function finalizeVerified(mission: any, pr: any, files: any[], mergeSha: string) {
  const step = missionStep(mission);
  if (!step) return { status: "failed", error: "mission_plan_missing" };

  const result = {
    status: "succeeded",
    executor_type: "agent",
    operation: String(step.operation ?? "delegate"),
    agent_id: String(step.target?.agent_id ?? "aria-agent-coding-v1"),
    response: {
      content: "ARIA verification supervisor confirmed PR CI, merge to main, and required main workflow evidence.",
      verification_status: "verified",
      verified: true,
    },
    repair: {
      changed: true,
      verified: true,
      verification_status: "verified_ci_merge_main",
      branch: pr.head_ref,
      pr: { number: pr.number, url: pr.url, merged: true, merge_sha: mergeSha },
      writes: files.map((f: any) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      summary: "Governed autonomous implementation completed and verified.",
    },
    evidence: {
      ci: "passed",
      merge: true,
      merge_sha: mergeSha,
      main_workflows: "passed",
    },
  };

  const checkpoint = {
    ...(mission.checkpoint ?? {}),
    completed_steps: [String(step.id)],
    results: { ...(mission.checkpoint?.results ?? {}), [String(step.id)]: result },
    autonomy_supervision: {
      version: "autonomy-operator-v1",
      verification: "ci-merge-main-ci",
      verified_at: new Date().toISOString(),
      pr_number: pr.number,
      merge_sha: mergeSha,
    },
    recovery: { status: "supervisor_verified" },
  };

  const updated = await updateBlocked(mission, {
    status: "running",
    current_step: 1,
    total_steps: 1,
    completed_steps: 1,
    next_action: "verify_goal",
    checkpoint,
  });
  if (!updated) return { status: "failed", error: "mission_lease_lost" };

  const canonical = await fetch(CANONICAL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}`, "x-aria-trigger": "meditation-ia" },
    body: JSON.stringify({ mission_id: mission.mission_id }),
  });
  const payload = await canonical.json().catch(() => ({}));
  return { status: canonical.ok ? "finalization_dispatched" : "finalization_failed", canonical_status: canonical.status, payload };
}

async function queueFinalize(missionId: string) {
  await sb.schema("aria_internal").from("meditation_queue")
    .update({ status: "completed", last_error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("resolved_mission_id", missionId)
    .in("status", ["queued", "running", "paused"]);
}

async function superviseMission(mission: any) {
  const branch = safeBranch(mission.mission_id);
  const step = missionStep(mission);

  let prs = await github("pr_find", { branch, base: "main", state: "all" });
  let pr = Array.isArray(prs?.items) ? prs.items[0] : null;
  if (!pr) {
    await updateBlocked(mission, {
      status: "blocked",
      next_action: "verification:awaiting_aria_pr",
      checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: "waiting_for_pr", branch, checked_at: new Date().toISOString() } },
    });
    return { mission_id: mission.mission_id, status: "awaiting_pr", branch };
  }

  const prRead = await github("pr_read", { number: Number(pr.number) });
  pr = { ...pr, ...prRead, number: Number(pr.number) };

  if (pr.merged === true) {
    const filesBody = await github("pr_files", { number: Number(pr.number) });
    const files = Array.isArray(filesBody?.files) ? filesBody.files : [];
    const verification = await verifyMainAfterMerge(String(pr?.merge_commit_sha ?? pr?.merge_sha ?? pr?.head_sha ?? ""), files);
    if (verification.status === "awaiting_main_ci") {
      await updateBlocked(mission, {
        status: "blocked",
        next_action: "verification:awaiting_main_ci",
        checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: verification.status, pr_number: pr.number, merge_sha: pr.merge_sha ?? pr.head_sha, checked_at: new Date().toISOString(), verification } },
      });
      return { mission_id: mission.mission_id, status: verification.status, pr_number: pr.number };
    }
    if (verification.status === "main_ci_failed") {
      await updateBlocked(mission, {
        status: "failed",
        next_action: "recovery:main_ci_failed",
        last_stderr: "ARIA autonomous verification detected a failed main workflow after merge.",
        checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: verification.status, pr_number: pr.number, verification } },
      });
      return { mission_id: mission.mission_id, status: "failed", pr_number: pr.number };
    }
    const finalized = await finalizeVerified(mission, pr, files, String(pr?.merge_commit_sha ?? pr?.merge_sha ?? pr?.head_sha ?? ""));
    if (finalized.status === "finalization_dispatched" && finalized.payload?.status === "succeeded") {
      await queueFinalize(mission.mission_id);
    }
    return { mission_id: mission.mission_id, status: finalized.status, pr_number: pr.number, verification };
  }

  const filesBody=await github("pr_files",{number:Number(pr.number)});
  const files=Array.isArray(filesBody?.files)?filesBody.files:[];
  const paths=files.map((x:any)=>String(x?.filename||""));
  const checks = await github("pr_checks", { number: Number(pr.number), paths });
  if (Number(checks.failed ?? 0) > 0) {
    await updateBlocked(mission, {
      status: "failed",
      next_action: "recovery:pr_ci_failed",
      last_stderr: "ARIA autonomous verification detected failed PR checks.",
      checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: "pr_ci_failed", pr_number: pr.number, verification: checks } },
    });
    return { mission_id: mission.mission_id, status: "failed", pr_number: pr.number };
  }
  if (Number(checks.pending ?? 0) > 0 || checks.all_passed !== true) {
    await updateBlocked(mission, {
      status: "blocked",
      next_action: "verification:awaiting_ci_or_live_verification",
      checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: "awaiting_pr_ci", pr_number: pr.number, branch, verification: checks, checked_at: new Date().toISOString() } },
    });
    return { mission_id: mission.mission_id, status: "awaiting_pr_ci", pr_number: pr.number };
  }

  if (!autoMergeAllowed(mission, step)) {
    await updateBlocked(mission, {
      status: "blocked",
      next_action: "human_gate:confirm",
      checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: "human_gate_required", pr_number: pr.number, branch, checked_at: new Date().toISOString() } },
    });
    return { mission_id: mission.mission_id, status: "human_gate_required", pr_number: pr.number };
  }

  try {
    const merged = await github("pr_merge", {
      number: Number(pr.number),
      branch,
      base: "main",
      risk_level: "LOW_RISK_WRITE",
      auto_merge: true,
      paths,
      commit_title: `ARIA autonomous repair: ${mission.mission_id}`,
      commit_message: "Merged by ARIA after governed CI verification.",
    });
    const mergeSha = String(merged?.sha ?? "");
    return { mission_id: mission.mission_id, status: "merged", pr_number: pr.number, merge_sha: mergeSha };
  } catch (error) {
    await updateBlocked(mission, {
      status: "blocked",
      next_action: "verification:awaiting_aria_merge",
      last_stderr: error instanceof Error ? error.message : String(error),
      checkpoint: { ...(mission.checkpoint ?? {}), autonomy_supervision: { status: "merge_pending", pr_number: pr.number, branch, checked_at: new Date().toISOString() } },
    });
    return { mission_id: mission.mission_id, status: "merge_pending", pr_number: pr.number };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(req))) return out({ error: "unauthorized" }, 401);

  try {
    const queueRecovery = await ensureQueuedMissions();

    const { data, error } = await sb.schema("aria_internal")
      .from("mission_state")
      .select("mission_id,goal,status,total_steps,current_step,completed_steps,next_action,last_stderr,checkpoint,metadata,updated_at,created_at")
      .eq("status", "blocked")
      .eq("next_action", "verification:awaiting_ci_or_live_verification")
      .contains("metadata", { autonomy_managed: true })
      .order("updated_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);

    const results:any[] = [];
    for (const mission of data ?? []) {
      try { results.push(await superviseMission(mission)); }
      catch (error) {
        results.push({ mission_id: mission.mission_id, status: "supervisor_error", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return out({ ok: true, supervisor: WORKER, queue_recovery: queueRecovery, scanned: data?.length ?? 0, results });
  } catch (error) {
    return out({ ok: false, supervisor: WORKER, error: error instanceof Error ? error.message : String(error) }, 200);
  }
});
