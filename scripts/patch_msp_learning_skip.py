from pathlib import Path
import urllib.request

# Always patch from current main tip so we keep terminal-failed path.
url = "https://raw.githubusercontent.com/Robvg9/aria-worker/main/supabase/functions/aria-mission-runner-v22/index.ts"
src = urllib.request.urlopen(url).read().decode()
assert "V_LOGICAL" in src
assert "model_execution_failed_all_routes" in src

old = (
    '    const learningGate = await validateLearningGate(String(mission.goal || ""), steps);\n'
    '    const previousLearningAttempts = Number(mission?.checkpoint?.learning_gate?.replan_attempts || 0);\n'
    '    if (learningGate.passed !== true) {'
)
new = (
    '    // MSP probes with fault_injection plans must not be rewritten by learning preflight.\n'
    '    const probeId = String(mission?.metadata?.probe || "");\n'
    '    const isMspProbe = probeId.startsWith("msp_");\n'
    '    const hasFaultPlan = Array.isArray(steps) && steps.some((s: any) => typeof s?.input?.fault_injection === "string");\n'
    '    const learningGate = (isMspProbe && hasFaultPlan)\n'
    '      ? { version: "mastery-learning-loop-v1", passed: true, required: [], applied_memory_ids: [], missing: [], skipped_for_msp_probe: true }\n'
    '      : await validateLearningGate(String(mission.goal || ""), steps);\n'
    '    const previousLearningAttempts = Number(mission?.checkpoint?.learning_gate?.replan_attempts || 0);\n'
    '    if (learningGate.passed !== true) {'
)
if "skipped_for_msp_probe" not in src:
    if old not in src:
        raise SystemExit("learning anchor missing")
    src = src.replace(old, new, 1)

out = Path("supabase/functions/aria-mission-runner-v22/index.ts")
out.write_text(src)
assert "skipped_for_msp_probe" in out.read_text()
print("ok", len(src))
