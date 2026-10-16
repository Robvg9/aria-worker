// ARIA Mission Consistency Guard v1
// Read-only analysis of the canonical mission -> step -> execution-job -> event chain.
// It does not mutate state; callers may persist or surface the returned diagnosis.

const TERMINAL_MISSIONS = new Set(['succeeded','failed','blocked','cancelled']);
const NONTERMINAL_STEPS = new Set(['pending','running','waiting','blocked','failed']);
const ACTIVE_JOBS = new Set(['queued','claimed','running']);
const TERMINAL_JOBS = new Set(['succeeded','failed','timeout','cancelled','blocked']);

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timeValue(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function push(checks, code, severity, message, evidence = {}) {
  checks.push({ code, severity, message, evidence });
}

export function analyzeMissionConsistency({ mission, steps = [], jobs = [], events = [], jobEvents = [] } = {}) {
  const checkedAt = new Date().toISOString();

  if (!mission || !clean(mission.mission_id)) {
    return {
      version: 'aria-mission-consistency-v1.0.0',
      status: 'inconsistent',
      checked_at: checkedAt,
      summary: 'No existe una misión canónica identificable.',
      checks: [{
        code: 'mission_missing',
        severity: 'critical',
        message: 'mission_state no contiene una identidad válida.',
        evidence: {}
      }],
      recommended_action: 'Restaurar o consultar el registro canónico mission_state antes de ejecutar trabajo nuevo.'
    };
  }

  const missionId = clean(mission.mission_id);
  const missionStatus = clean(mission.status) || 'unknown';
  const totalSteps = Number.isFinite(Number(mission.total_steps)) ? Number(mission.total_steps) : null;
  const completedSteps = Number.isFinite(Number(mission.completed_steps)) ? Number(mission.completed_steps) : null;
  const currentStep = Number.isFinite(Number(mission.current_step)) ? Number(mission.current_step) : null;
  const maxStep = steps.reduce((max, step) => Math.max(max, Number(step?.step_index || 0)), 0);
  const nonterminalSteps = steps.filter(step => NONTERMINAL_STEPS.has(clean(step?.status) || ''));
  const pendingOrRunningSteps = steps.filter(step => ['pending','running','waiting'].includes(clean(step?.status) || ''));
  const activeJobs = jobs.filter(job => ACTIVE_JOBS.has(clean(job?.status) || ''));
  const liveJobs = jobs.filter(job => ['claimed','running'].includes(clean(job?.status) || ''));
  const queuedJobs = jobs.filter(job => clean(job?.status) === 'queued');
  const terminalJobs = jobs
    .filter(job => TERMINAL_JOBS.has(clean(job?.status) || '') && timeValue(job?.completed_at))
    .sort((a,b) => timeValue(b?.completed_at) - timeValue(a?.completed_at));

  const checks = [];

  if (currentStep != null && totalSteps != null && currentStep > totalSteps) {
    push(checks, 'current_step_out_of_range', 'error',
      'current_step supera total_steps.',
      { current_step: currentStep, total_steps: totalSteps });
  }

  if (currentStep != null && maxStep > 0 && currentStep > maxStep) {
    push(checks, 'current_step_missing_materialization', 'error',
      'current_step apunta a un paso que no está materializado en mission_steps.',
      { current_step: currentStep, max_materialized_step: maxStep });
  }

  if (completedSteps != null && totalSteps != null && completedSteps > totalSteps) {
    push(checks, 'completed_steps_exceed_total', 'critical',
      'completed_steps supera total_steps.',
      { completed_steps: completedSteps, total_steps: totalSteps });
  }

  if (missionStatus === 'succeeded') {
    if (totalSteps != null && completedSteps != null && completedSteps < totalSteps) {
      push(checks, 'succeeded_before_all_steps', 'critical',
        'La misión figura succeeded antes de completar todos los pasos declarados.',
        { completed_steps: completedSteps, total_steps: totalSteps });
    }
    if (nonterminalSteps.length > 0) {
      push(checks, 'terminal_mission_has_nonterminal_steps', 'critical',
        'La misión es terminal pero todavía existen pasos no terminales.',
        { nonterminal_steps: nonterminalSteps.map(s => Number(s.step_index)) });
    }
  }

  if (TERMINAL_MISSIONS.has(missionStatus) && activeJobs.length > 0) {
    push(checks, 'terminal_mission_has_active_jobs', 'critical',
      'La misión es terminal pero conserva execution_jobs activos.',
      { active_job_ids: activeJobs.map(j => clean(j.job_id)).filter(Boolean) });
  }

  if (TERMINAL_MISSIONS.has(missionStatus) && queuedJobs.length > 0) {
    push(checks, 'terminal_mission_has_queued_jobs', 'error',
      'La misión es terminal pero mantiene jobs en cola.',
      { queued_job_ids: queuedJobs.map(j => clean(j.job_id)).filter(Boolean) });
  }

  const pendingJobs = mission?.checkpoint?.pending_jobs;
  const pendingJobIds = pendingJobs && typeof pendingJobs === 'object'
    ? Object.keys(pendingJobs)
    : [];
  const resumePendingDeviceJob = String(mission?.next_action || '').startsWith('resume: pending device job');

  if (resumePendingDeviceJob && activeJobs.length === 0 && pendingJobIds.length === 0) {
    push(checks, 'pending_device_job_missing', 'critical',
      'La misión declara que espera un device job, pero no existe un job activo ni pending_jobs.',
      { next_action: clean(mission?.next_action), pending_job_count: pendingJobIds.length });
  }

  const latestTerminalJob = terminalJobs[0];
  if (latestTerminalJob) {
    const completedAt = timeValue(latestTerminalJob.completed_at);
    const missionUpdatedAt = timeValue(mission?.updated_at);
    const missionEventsAfterJob = events.some(event => {
      const eventAt = timeValue(event?.created_at);
      return eventAt != null && eventAt > completedAt;
    });
    const jobEventsAfterJob = jobEvents.some(event => {
      const eventAt = timeValue(event?.created_at);
      const eventJobId = clean(event?.job_id);
      return eventAt != null && eventAt > completedAt && eventJobId === clean(latestTerminalJob.job_id);
    });

    if (!TERMINAL_MISSIONS.has(missionStatus) &&
        missionUpdatedAt != null &&
        missionUpdatedAt <= completedAt &&
        !missionEventsAfterJob) {
      push(checks, 'terminal_job_without_mission_progress', 'error',
        'Un execution_job terminal terminó después de la última actualización de la misión sin evidencia posterior de progreso de mission_state/mission_events.',
        {
          job_id: clean(latestTerminalJob.job_id),
          job_status: clean(latestTerminalJob.status),
          job_completed_at: latestTerminalJob.completed_at,
          mission_updated_at: mission?.updated_at,
          job_event_after_completion: jobEventsAfterJob
        });
    }
  }

  if (missionStatus === 'running' && pendingOrRunningSteps.length === 0 && totalSteps != null && completedSteps != null && completedSteps < totalSteps) {
    push(checks, 'running_mission_without_materialized_work', 'warning',
      'La misión está running, tiene pasos incompletos declarados, pero no hay pasos pending/running/waiting materializados.',
      { completed_steps: completedSteps, total_steps: totalSteps });
  }

  let status = 'consistent';
  if (checks.some(c => c.severity === 'critical' || c.severity === 'error')) status = 'inconsistent';
  else if (checks.some(c => c.severity === 'warning')) status = 'degraded';

  const recommendedAction = status === 'consistent'
    ? 'Continuar con el runner canónico; no se detectó drift estructural en la cadena de misión.'
    : checks[0]?.code === 'terminal_job_without_mission_progress'
      ? 'Ejecutar/revisar la continuación canónica de la misión y conservar el job terminal como evidencia.'
      : 'Inspeccionar la evidencia indicada y reconciliar mission_state antes de crear un trabajo paralelo.';

  return {
    version: 'aria-mission-consistency-v1.0.0',
    mission_id: missionId,
    status,
    checked_at: checkedAt,
    summary: status === 'consistent'
      ? 'Cadena misión → steps → execution_jobs → eventos consistente con la evidencia disponible.'
      : \`Detectadas ${checks.length} discrepancia(s) potencial(es) en la cadena canónica.\`,
    checks,
    counts: {
      steps: steps.length,
      nonterminal_steps: nonterminalSteps.length,
      active_jobs: activeJobs.length,
      terminal_jobs: terminalJobs.length,
      mission_events: events.length,
      execution_job_events: jobEvents.length
    },
    recommended_action: recommendedAction
  };
}
