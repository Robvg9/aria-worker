#!/usr/bin/env python3
"""One-shot supervised Mission Wonder 2 Gate 3 LIVE fallback proof.

This script deliberately creates one READ-only model mission with one non-retryable
step. Google returns an injected HTTP 429; only OpenRouter Nemotron Free may make
one real upstream request. Global mission execution remains frozen throughout.
"""
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

GOOGLE = {
    "provider_id": "google",
    "account_id": "acct_google_gemini_free",
    "model_id": "google/gemini-3.5-flash-lite-direct",
}
OPENROUTER = {
    "provider_id": "openrouter",
    "account_id": "acct_openrouter_primary",
    "model_id": "nvidia/nemotron-3.5-lightning:free",
}
EXPECTED_TEXT = "MISSION_WONDER_2_GATE3_OK"


def fail(message):
    raise RuntimeError(message)


def require_env(name):
    value = os.environ.get(name, "")
    if not value:
        fail("required environment variable missing: " + name)
    return value


PROJECT = require_env("SUPABASE_PROJECT_REF")
RUNTIME_SECRET = require_env("ARIA_RUNTIME_SHARED_SECRET")
ACCESS_TOKEN = require_env("SUPABASE_ACCESS_TOKEN")
RUN_ID = require_env("GITHUB_RUN_ID")
RUN_ATTEMPT = require_env("GITHUB_RUN_ATTEMPT")
GH_TOKEN = require_env("GH_TOKEN")
GH_REPO = require_env("GITHUB_REPOSITORY")
GH_SHA = require_env("GITHUB_SHA")
GH_REF = require_env("GITHUB_REF")

if GH_REF != "refs/heads/main":
    fail("this supervised production probe can run only from refs/heads/main")
if not re.fullmatch(r"[0-9a-f]{40}", GH_SHA):
    fail("invalid workflow commit SHA")

MISSION_ID = f"mission_wonder_2_gate3_probe_{RUN_ID}_{RUN_ATTEMPT}"
STEP_ID = "gate3_provider_fallback"
now = dt.datetime.now(dt.timezone.utc)
issued_at = now.isoformat(timespec="seconds").replace("+00:00", "Z")
expires_at = (now + dt.timedelta(minutes=10)).isoformat(timespec="seconds").replace("+00:00", "Z")


def supabase_sql(query, allow_write=False):
    # Current Supabase CLI requires explicit consent for hosted SQL writes.
    # Read paths stay read-only; only this harness's reviewed INSERT/UPDATE
    # and the one Human Gate approval RPC receive --yes.
    mode_flag = "--yes" if allow_write else "--read-only"
    proc = subprocess.run(
        ["supabase", "db", "query", "--linked", query, mode_flag],
        text=True,
        capture_output=True,
        check=False,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        # Do not echo full SQL if it contains structured mission data.
        print("SUPABASE_SQL_FAILED exit=" + str(proc.returncode))
        print(output[-5000:])
        fail("Supabase SQL command failed")
    return output


def check_sql(query, marker, label, allow_write=False):
    output = supabase_sql(query, allow_write=allow_write)
    if marker not in output:
        print(label + "_OUTPUT=" + output[-5000:])
        fail(label + " did not return its PASS marker")
    print(label + "=PASS")


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def qjson(value):
    return q(json.dumps(value, separators=(",", ":"), ensure_ascii=False)) + "::jsonb"


def github_deploy_exact_sha():
    url = f"https://api.github.com/repos/{GH_REPO}/actions/runs?head_sha={GH_SHA}&per_page=100"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": "Bearer " + GH_TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.loads(response.read().decode("utf-8"))
    passed = any(
        run.get("name") == "Deploy ARIA Supabase Runtime"
        and run.get("head_sha") == GH_SHA
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        for run in payload.get("workflow_runs", [])
    )
    if not passed:
        fail("the canonical Supabase runtime deployment for this exact main SHA is not green")
    print("EXACT_MAIN_SHA_SUPABASE_DEPLOY=PASS")


def http_post(function_slug, payload, timeout=70):
    url = f"https://{PROJECT}.supabase.co/functions/v1/{function_slug}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + RUNTIME_SECRET,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except Exception:
                body = {"raw": raw[:1500]}
            return response.status, body
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw[:1500]}
        return error.code, body


def action_hash_for_step(step):
    # Matches runner canonicalGateStep: only these eight top-level keys enter
    # the normalized SHA-256 action binding. The normalizer sorts nested keys.
    canonical = {
        "id": step.get("id"),
        "operation": step.get("operation"),
        "executor_type": step.get("executor_type"),
        "risk": step.get("risk", "READ"),
        "target": step.get("target"),
        "input": step.get("input"),
        "policy": step.get("policy"),
        "authorization": step.get("authorization"),
    }
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def route_preflight():
    query = """
    SELECT CASE WHEN
      (SELECT count(*) FROM aria_internal.model_registry
        WHERE provider_id='google' AND model_id='google/gemini-3.5-flash-lite-direct'
          AND status='available' AND enabled=true) = 1
      AND
      (SELECT count(*) FROM aria_internal.model_registry
        WHERE provider_id='openrouter' AND model_id='nvidia/nemotron-3.5-lightning:free'
          AND status='available' AND enabled=true) = 1
      AND
      (SELECT count(*) FROM aria_internal.account_registry
        WHERE account_id='acct_google_gemini_free' AND provider_id='google'
          AND status='available' AND enabled=true AND secret_present=true
          AND models @> '["google/gemini-3.5-flash-lite-direct"]'::jsonb) = 1
      AND
      (SELECT count(*) FROM aria_internal.account_registry
        WHERE account_id='acct_openrouter_primary' AND provider_id='openrouter'
          AND status='available' AND enabled=true AND secret_present=true
          AND models @> '["nvidia/nemotron-3.5-lightning:free"]'::jsonb) = 1
      AND
      (SELECT count(*) FROM aria_internal.quota_registry
        WHERE provider_id='google' AND account_id='acct_google_gemini_free'
          AND model_id='google/gemini-3.5-flash-lite-direct' AND status='available') = 1
      AND
      (SELECT count(*) FROM aria_internal.quota_registry
        WHERE provider_id='openrouter' AND account_id='acct_openrouter_primary'
          AND model_id='nvidia/nemotron-3.5-lightning:free' AND status='available'
          AND limits_requests > usage_requests) = 1
    THEN 'GATE3_ROUTE_PREFLIGHT_PASS' ELSE 'GATE3_ROUTE_PREFLIGHT_FAIL' END;
    """
    check_sql(query, "GATE3_ROUTE_PREFLIGHT_PASS", "GATE3_ROUTE_PREFLIGHT")


def create_and_approve_mission():
    step = {
        "id": STEP_ID,
        "operation": "text_generation",
        "executor_type": "model",
        "risk": "READ",
        "target": {
            "type": "model",
            "provider_id": GOOGLE["provider_id"],
            "account_id": GOOGLE["account_id"],
            "model_id": GOOGLE["model_id"],
        },
        "input": {
            "prompt": "Reply with exactly: " + EXPECTED_TEXT,
            "max_completion_tokens": 24,
            "fault_injection": "http_429",
        },
        "policy": {
            "human_gate_required": True,
            "allow_rate_limit_fallback": True,
            "mission_wonder_2_gate3_probe": True,
        },
        "authorization": {
            "status": "human_required",
            "risk_class": "READ",
            "evidence_ref": "workflow_dispatch:" + RUN_ID,
        },
        "retryable": False,
        "max_attempts": 1,
        "verify": {"response_content_equals": EXPECTED_TEXT},
    }
    digest = action_hash_for_step(step)
    scope = {
        "version": 1,
        "purpose": "mission_wonder_2_gate3_provider_fallback_v1",
        "enabled": True,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "max_provider_calls": 1,
        "review_ref": f"workflow_dispatch:{RUN_ID}:{RUN_ATTEMPT}",
    }
    checkpoint = {
        "plan": [step],
        "completed_steps": [],
        "attempts": {},
        "results": {},
        "human_gate": {
            "required": True,
            "status": "pending",
            "verified": False,
            "step_id": STEP_ID,
            "executor_type": "model",
            "operation": "text_generation",
            "risk": "READ",
            "action_hash": digest,
        },
    }
    metadata = {
        "goal_source": "mission_wonder_2_gate3",
        "execution_lane": "mission_wonder_2_gate3",
        "probe": "mission_wonder_2_gate3",
        "mission_wonder_2_gate3_scope": scope,
    }
    insert = f"""
    INSERT INTO aria_internal.mission_state
      (mission_id, goal, status, current_step, total_steps, completed_steps,
       checkpoint, metadata, lease_owner, lease_until)
    VALUES
      ({q(MISSION_ID)},
       'Mission Wonder 2 Gate 3 supervised READ-only provider fallback probe',
       'paused', 0, 1, 0, {qjson(checkpoint)}, {qjson(metadata)}, NULL, NULL);
    """
    # Mark cleanup required before sending INSERT: if the DB commits but the
    # CLI connection drops, the finally block must still revoke this mission.
    global mission_created
    mission_created = True
    supabase_sql(insert, allow_write=True)
    print("ONE_STEP_MISSION_CREATED=PASS")

    approve = f"""
    SELECT CASE
      WHEN (public.mission_human_gate_decide(
        {q(MISSION_ID)}, 'approve', 'github_workflow_dispatch', {q(digest)},
        'Explicit workflow_dispatch approval: one bounded READ-only Gate 3 probe; Google 429 is synthetic; one OpenRouter Nemotron Free call maximum.'
      )->>'approval_token_issued') = 'true'
      THEN 'GATE3_HUMAN_GATE_APPROVAL_PASS'
      ELSE 'GATE3_HUMAN_GATE_APPROVAL_FAIL'
    END;
    """
    check_sql(approve, "GATE3_HUMAN_GATE_APPROVAL_PASS", "GATE3_HUMAN_GATE", allow_write=True)
    verify = f"""
    SELECT CASE WHEN status='queued'
      AND checkpoint->'human_gate'->>'status'='approved'
      AND length(coalesce(checkpoint->'human_gate'->>'approval_token','')) >= 32
      AND checkpoint->'human_gate'->>'action_hash'={q(digest)}
    THEN 'GATE3_APPROVED_ROW_PASS' ELSE 'GATE3_APPROVED_ROW_FAIL' END
    FROM aria_internal.mission_state WHERE mission_id={q(MISSION_ID)};
    """
    check_sql(verify, "GATE3_APPROVED_ROW_PASS", "GATE3_APPROVED_ROW")
    return step


def verify_live_result():
    query = f"""
    SELECT CASE WHEN
      status='succeeded'
      AND completed_steps=1
      AND checkpoint #>> '{{results,{STEP_ID},provider_id}}'='openrouter'
      AND checkpoint #>> '{{results,{STEP_ID},model_id}}'='nvidia/nemotron-3.5-lightning:free'
      AND checkpoint #>> '{{results,{STEP_ID},model_fallback_used}}'='true'
      AND checkpoint #>> '{{results,{STEP_ID},model_fallback_attempts}}'='1'
      AND checkpoint #>> '{{results,{STEP_ID},model_execution_failures,0,provider_id}}'='google'
      AND checkpoint #>> '{{results,{STEP_ID},model_execution_failures,0,provider_status}}'='429'
      AND checkpoint #>> '{{results,{STEP_ID},model_execution_failures,0,code}}'='provider_error'
      AND checkpoint #>> '{{attempts,{STEP_ID}}}'='1'
    THEN 'GATE3_LIVE_EVIDENCE_PASS'
    ELSE 'GATE3_LIVE_EVIDENCE_FAIL'
    END
    FROM aria_internal.mission_state WHERE mission_id={q(MISSION_ID)};
    """
    check_sql(query, "GATE3_LIVE_EVIDENCE_PASS", "GATE3_LIVE_EVIDENCE")


def revoke_scope():
    query = f"""
    UPDATE aria_internal.mission_state
       SET metadata=jsonb_set(
             coalesce(metadata,'{{}}'::jsonb),
             '{{mission_wonder_2_gate3_scope,enabled}}',
             'false'::jsonb, true
           ) || jsonb_build_object('mission_wonder_2_gate3_scope_revoked_at',clock_timestamp()::text),
           checkpoint=jsonb_set(
             coalesce(checkpoint,'{{}}'::jsonb),
             '{{human_gate,approval_token}}',
             '""'::jsonb, true
           ),
           status=CASE WHEN status IN ('queued','running','waiting') THEN 'paused' ELSE status END,
           next_action='terminal: supervised Gate 3 scope revoked',
           lease_owner=NULL,
           lease_until=NULL,
           updated_at=clock_timestamp()
     WHERE mission_id={q(MISSION_ID)}
     RETURNING mission_id;
    """
    output = supabase_sql(query, allow_write=True)
    if MISSION_ID not in output:
        # The INSERT may have failed before committing; no scoped authority exists.
        print("GATE3_SCOPE_REVOKE_NO_ROW=PASS")
        return
    verify = f"""
    SELECT CASE WHEN
      metadata #>> '{{mission_wonder_2_gate3_scope,enabled}}'='false'
      AND coalesce(checkpoint->'human_gate'->>'approval_token','')=''
      AND status NOT IN ('queued','running','waiting')
      AND lease_owner IS NULL
      AND lease_until IS NULL
    THEN 'GATE3_SCOPE_REVOKE_VERIFY_PASS'
    ELSE 'GATE3_SCOPE_REVOKE_VERIFY_FAIL'
    END
    FROM aria_internal.mission_state WHERE mission_id={q(MISSION_ID)};
    """
    check_sql(verify, "GATE3_SCOPE_REVOKE_VERIFY_PASS", "GATE3_SCOPE_REVOKE_VERIFY")
    print("GATE3_SCOPE_REVOKED=PASS")

def verify_global_freeze():
    for slug in (
        "aria-canonical-runtime-v1",
        "aria-mission-runner-v22",
        "aria-execution-runtime-v1",
    ):
        status, _body = http_post(slug, {}, timeout=20)
        if status != 423:
            fail(slug + " did not remain frozen after the supervised probe (HTTP " + str(status) + ")")
        print(slug + "_GLOBAL_FREEZE=PASS")


def main():
    global mission_created
    mission_created = False
    try:
        github_deploy_exact_sha()
        subprocess.run(["supabase", "link", "--project-ref", PROJECT], check=True, text=True, capture_output=True)
        route_preflight()
        create_and_approve_mission()

        status, response = http_post("aria-mission-runner-v22", {"mission_id": MISSION_ID}, timeout=90)
        print("SCOPED_RUNNER_HTTP=" + str(status))
        print("SCOPED_RUNNER_STATUS=" + str(response.get("status", "unknown")))
        if status != 200 or response.get("status") != "succeeded":
            fail("scoped mission did not complete successfully; global pause remains active")

        verify_live_result()
        print("GATE3_PROVIDER_FALLBACK_LIVE=PASS")
    finally:
        cleanup_error = None
        freeze_error = None
        if mission_created:
            try:
                revoke_scope()
            except Exception as error:
                cleanup_error = error
                print("GATE3_SCOPE_REVOKE_ERROR=" + str(error))
        try:
            verify_global_freeze()
        except Exception as error:
            freeze_error = error
            print("GATE3_GLOBAL_FREEZE_VERIFY_ERROR=" + str(error))
        if cleanup_error and freeze_error:
            raise RuntimeError("scope revocation and global freeze verification both failed")
        if freeze_error:
            raise freeze_error
        if cleanup_error:
            raise cleanup_error


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("MISSION_WONDER_2_GATE3_LIVE_E2E=FAIL: " + str(error))
        sys.exit(1)
