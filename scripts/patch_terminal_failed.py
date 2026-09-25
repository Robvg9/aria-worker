from pathlib import Path
import urllib.request

url = "https://raw.githubusercontent.com/Robvg9/aria-worker/70d9b6c91fc1ca3db70121783f7141ab1bf393b6/supabase/functions/aria-mission-runner-v22/index.ts"
src = urllib.request.urlopen(url).read().decode()
assert "V_LOGICAL" in src and "live-resilience-inject" in src

if "model_execution_failed_all_routes" not in src:
    anchor = (
        "        const replanCount = Number(mission?.checkpoint?.recovery?.replan_count || 0) + 1;\n"
        "        const failedStepIds = failures.map((item) => String(item.step.id));\n"
        "        const previousPlan = steps;\n"
        "        const previousResults = results;\n"
        "        const maxReplans = 2;\n"
        "        if (replanCount <= maxReplans) {"
    )
    insert = Path("scripts/terminal_failed_insert.txt").read_text()
    if anchor not in src:
        raise SystemExit("anchor missing")
    src = src.replace(anchor, insert, 1)

old_hb = (
    '        await updateMission(missionId, {\n'
    '          status: "blocked",\n'
    '          current_step: completed.size,\n'
    '          completed_steps: completed.size,\n'
    '          next_action: hardBlock.next_action,\n'
    '          last_stderr: "retry_exhausted_all_strategies",\n'
    '          checkpoint: { ...checkpoint, recovery: { status: "hard_block", replan_count: replanCount, failed_step_ids: failedStepIds, block_details: hardBlock } },\n'
    '          lease_owner: null,\n'
    '          lease_until: null,\n'
    '        });\n'
    '        await emitEvent(missionId, "mission_hard_blocked", hardBlock);\n'
    '        return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V, completed_steps: completed.size, failed_steps: failedStepIds, block_details: hardBlock });'
)
new_hb = (
    '        await emitEvent(missionId, "mission_hard_blocked", hardBlock);\n'
    '        await updateMission(missionId, {\n'
    '          status: "blocked",\n'
    '          current_step: completed.size,\n'
    '          completed_steps: completed.size,\n'
    '          next_action: hardBlock.next_action,\n'
    '          last_stderr: "retry_exhausted_all_strategies",\n'
    '          checkpoint: { ...checkpoint, recovery: { status: "hard_block", replan_count: replanCount, failed_step_ids: failedStepIds, block_details: hardBlock } },\n'
    '          lease_owner: null,\n'
    '          lease_until: null,\n'
    '        });\n'
    '        return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V_LOGICAL, invocation_id: V, completed_steps: completed.size, failed_steps: failedStepIds, block_details: hardBlock });'
)
if old_hb in src:
    src = src.replace(old_hb, new_hb, 1)

old_rp = (
    '          await updateMission(missionId, {\n'
    '            status: "queued",\n'
    '            current_step: 0,\n'
    '            completed_steps: 0,\n'
    '            next_action: "replan: discard failed strategy and build an alternative",\n'
    '            last_stderr: "retry_exhausted_replanned",\n'
    '            checkpoint: {\n'
    '              ...checkpoint,\n'
    '              plan: undefined,\n'
    '              completed_steps: [],\n'
    '              attempts: {},\n'
    '              results: {},\n'
    '              pending_jobs: {},\n'
    '              recovery,\n'
    '            },\n'
    '            lease_owner: null,\n'
    '            lease_until: null,\n'
    '          });\n'
    '          await emitEvent(missionId, "mission_replanned", recovery);\n'
    '          return out({\n'
    '            ok: true,\n'
    '            status: "replanned",\n'
    '            mission_id: missionId,\n'
    '            runtime: V,\n'
    '            next_action: "replan: discard failed strategy and build an alternative",\n'
    '            recovery,\n'
    '          });'
)
new_rp = (
    '          await emitEvent(missionId, "mission_replanned", recovery);\n'
    '          await updateMission(missionId, {\n'
    '            status: "queued",\n'
    '            current_step: 0,\n'
    '            completed_steps: 0,\n'
    '            next_action: "replan: discard failed strategy and build an alternative",\n'
    '            last_stderr: "retry_exhausted_replanned",\n'
    '            checkpoint: {\n'
    '              ...checkpoint,\n'
    '              plan: undefined,\n'
    '              completed_steps: [],\n'
    '              attempts: {},\n'
    '              results: {},\n'
    '              pending_jobs: {},\n'
    '              recovery,\n'
    '            },\n'
    '            lease_owner: null,\n'
    '            lease_until: null,\n'
    '          });\n'
    '          return out({\n'
    '            ok: true,\n'
    '            status: "replanned",\n'
    '            mission_id: missionId,\n'
    '            runtime: V_LOGICAL,\n'
    '            invocation_id: V,\n'
    '            next_action: "replan: discard failed strategy and build an alternative",\n'
    '            recovery,\n'
    '          });'
)
if old_rp in src:
    src = src.replace(old_rp, new_rp, 1)

out = Path("supabase/functions/aria-mission-runner-v22/index.ts")
out.write_text(src)
assert "model_execution_failed_all_routes" in out.read_text()
print("patched", len(src))
