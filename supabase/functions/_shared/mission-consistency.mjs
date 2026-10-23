// Read-only integrity checks for the canonical mission -> step -> execution-job chain.
// Diagnostics only: this module never mutates mission or job state.
const TERMINAL_MISSIONS = new Set(["succeeded", "failed", "blocked", "cancelled"]);
const ACTIVE_JOBS = new Set(["queued", "claimed", "running"]);
const TERMINAL_JOBS = new Set(["succeeded", "failed", "timeout", "cancelled", "blocked"]);
const PROGRESS_EVENTS = new Set([
  "step_started", "step_succeeded", "step_failed", "mission_waiting",
  "mission_resumed", "mission_replanned", "mission_succeeded", "mission_failed",
  "checkpoint_saved", "execution_job_reconciled"
]);

const clean = value => typeof value === "string" && value.trim() ? value.trim() : null;
const timestamp = value => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
};

export function analyzeMissionConsistency({ mission, steps = [], jobs = [], events = [], jobEvents = [] } = {}) {
  const checkedAt = new Date().toISOString();
  const checks = [];
  const add = (code, severity, message, evidence = {}) => checks.push({ code, severity, message, evidence });
  const missionId = clean(mission?.mission_id);
  if (!missionId) {
    add("mission_missing", "critical", "No existe una identidad canónica de misión verificable.");
    return { version: "aria-mission-consistency-v1.1.0", mission_id: null, status: "inconsistent", checked_at: checkedAt,
      summary: "No se puede verificar la cadena sin una misión canónica.", checks, counts: { steps: 0, active_jobs: 0, terminal_jobs: 0 },
      recommended_action: "Consultar mission_state antes de reintentar o crear trabajo paralelo." };
  }

  const missionStatus = clean(mission.status) || "unknown";
  const total = Number.isFinite(Number(mission.total_steps)) && mission.total_steps != null ? Number(mission.total_steps) : null;
  const completed = Number.isFinite(Number(mission.completed_steps)) && mission.completed_steps != null ? Number(mission.completed_steps) : null;
  const current = Number.isFinite(Number(mission.current_step)) && mission.current_step != null ? Number(mission.current_step) : null;
  const scopedEvents = events.filter(event => !clean(event?.mission_id) || clean(event.mission_id) === missionId);
  // A caller may pass a mixed job collection. Never let another mission's job
  // make this mission look inconsistent (or hide a missing-job condition).
  const scopedJobs = jobs.filter(job => clean(job?.mission_id) === missionId);
  const activeJobs = scopedJobs.filter(job => ACTIVE_JOBS.has(clean(job?.status) || ""));
  const terminalJobs = scopedJobs.filter(job => TERMINAL_JOBS.has(clean(job?.status) || "") && timestamp(job?.completed_at) != null)
    .sort((a, b) => timestamp(b.completed_at) - timestamp(a.completed_at));
  const pendingJobs = mission?.checkpoint?.pending_jobs && typeof mission.checkpoint.pending_jobs === "object"
    ? mission.checkpoint.pending_jobs : {};
  const pendingJobIds = Object.values(pendingJobs).map(item => clean(item?.job_id)).filter(Boolean);

  if (total != null && completed != null && completed > total)
    add("completed_steps_exceed_total", "critical", "completed_steps supera total_steps.", { completed_steps: completed, total_steps: total });
  if (total != null && current != null && current > total)
    add("current_step_out_of_range", "error", "current_step supera total_steps.", { current_step: current, total_steps: total });

  if (missionStatus === "succeeded") {
    if (total != null && completed != null && completed < total)
      add("succeeded_before_all_steps", "critical", "La misión figura succeeded con pasos declarados incompletos.", { completed_steps: completed, total_steps: total });
    const unsuccessful = steps.filter(step => !["succeeded", "completed", "skipped"].includes(clean(step?.status) || ""));
    if (unsuccessful.length)
      add("succeeded_with_unsuccessful_steps", "critical", "La misión figura succeeded, pero hay pasos no confirmados como completados.", {
        steps: unsuccessful.map(step => ({ step_index: step?.step_index ?? null, status: clean(step?.status) }))
      });
  }

  if (TERMINAL_MISSIONS.has(missionStatus) && activeJobs.length)
    add("terminal_mission_has_active_jobs", "critical", "Una misión terminal conserva jobs activos.", {
      active_job_ids: activeJobs.map(job => clean(job.job_id)).filter(Boolean)
    });

  const waitingForJob = /pending (?:device|local|windows|qwen).*job/i.test(String(mission?.next_action || ""));
  if (waitingForJob && pendingJobIds.length === 0 && activeJobs.length === 0)
    add("pending_job_missing", "critical", "La misión declara que espera un job, pero no hay referencia pendiente ni job activo.", {
      next_action: clean(mission.next_action)
    });

  const latest = terminalJobs[0];
  if (latest && !TERMINAL_MISSIONS.has(missionStatus)) {
    const doneAt = timestamp(latest.completed_at);
    const updatedAt = timestamp(mission.updated_at);
    const progressAfter = scopedEvents.some(event => PROGRESS_EVENTS.has(clean(event?.event_type) || "") &&
      timestamp(event?.created_at) != null && timestamp(event.created_at) > doneAt);
    if (updatedAt != null && updatedAt <= doneAt && !progressAfter)
      add("terminal_job_without_mission_progress", "error", "Un job terminó sin evidencia posterior de avance de la misión.", {
        job_id: clean(latest.job_id), job_status: clean(latest.status), job_completed_at: latest.completed_at,
        mission_updated_at: mission.updated_at
      });
  }

  const status = checks.some(check => ["critical", "error"].includes(check.severity)) ? "inconsistent"
    : checks.some(check => check.severity === "warning") ? "degraded" : "consistent";
  return {
    version: "aria-mission-consistency-v1.1.0", mission_id: missionId, status, checked_at: checkedAt,
    summary: status === "consistent" ? "No se detectó drift estructural en la evidencia recibida."
      : `Detectadas ${checks.length} discrepancia(s) potencial(es) en la cadena canónica.`,
    checks,
    counts: { steps: steps.length, active_jobs: activeJobs.length, terminal_jobs: terminalJobs.length,
      mission_events: scopedEvents.length, execution_job_events: jobEvents.length },
    recommended_action: status === "consistent" ? "Continuar con el runner canónico; esta comprobación no sustituye la verificación funcional del resultado."
      : "Inspeccionar la evidencia indicada y reconciliar mission_state antes de crear trabajo paralelo."
  };
}
