const pad = (value: number) => String(Math.max(1, value)).padStart(2, '0');
const MISSION_TITLE_MAX = 36;

function compactMissionTitle(value: string): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MISSION_TITLE_MAX) return text;
  return text.slice(0, MISSION_TITLE_MAX - 1).trimEnd() + '…';
}

export function missionProjectLabel(mission: any): string {
  const raw = [
    mission?.project_id,
    mission?.metadata?.project_id,
    mission?.checkpoint?.project_id,
    mission?.project?.id,
    mission?.goal,
  ].filter(Boolean).join(' ').toLowerCase();

  if (raw.includes('battlecruiser')) return 'BattleCruiser';
  if (raw.includes('cuevacoin')) return 'CuevaCoin';
  if (raw.includes('chatbending')) return 'ChatBending';
  if (raw.includes('aria')) return 'ARIA';
  return 'General';
}

export function missionHumanTitle(mission: any): string {
  const goal = String(mission?.goal ?? '').trim();
  const project = missionProjectLabel(mission);

  let title = 'Misión de ARIA';
  if (/battlecruiser/i.test(goal)) title = 'Integración con BattleCruiser';
  else if (/cuevacoin/i.test(goal)) title = 'Operación CuevaCoin';
  else if (/(credenciales|usuario|contraseña|password|login|sesión)/i.test(goal)) title = 'Diagnóstico de acceso y credenciales';
  else if (/(rwht|real world human|prueba)/i.test(goal)) title = project === 'General' ? 'Prueba de ARIA' : `Prueba de ARIA · ${project}`;
  else if (/(dashboard|navegación|deslic|segunda pantalla|pantalla principal)/i.test(goal)) title = 'Mejora de navegación';
  else if (/(notific|avisos)/i.test(goal)) title = 'Mejora de notificaciones';
  else if (/(chat)/i.test(goal)) title = project === 'General' ? 'Mejora del chat' : `Chat · ${project}`;
  else if (/(android|pwa|aplicación|app)/i.test(goal)) title = project === 'General' ? 'Mejora de la app ARIA' : `Mejora de ${project}`;
  else if (/mandale|manda(le)? un mensaje|env(í|i)a.*mensaje/i.test(goal)) title = 'Envío de mensaje';
  else if (goal) title = project === 'General' ? 'Misión de ARIA' : `Misión · ${project}`;
  return compactMissionTitle(title);
}

export function missionListLabel(mission: any, index: number): string {
  const project = missionProjectLabel(mission);
  return `Misión ${pad(index + 1)} · ${project}`;
}

export function missionGoalPreview(mission: any, max = 110): string {
  const goal = String(mission?.goal ?? '').trim();
  if (!goal) return 'Sin objetivo registrado.';
  return goal.length > max ? goal.slice(0, max - 1).trimEnd() + '…' : goal;
}

export function missionActivityLabel(mission: any): string {
  const status = String(mission?.status || '').toLowerCase();
  const nextAction = String(mission?.next_action || '').toLowerCase();
  if (status === 'blocked') return 'Bloqueada · diagnóstico disponible';
  if (status === 'failed') return 'Falló · conserva evidencia para recuperación';
  if (status === 'cancelled') return 'Cancelada · sin ejecución activa';
  if (status === 'succeeded') return 'Completada · verificación registrada';
  if (status === 'waiting') return 'Esperando verificación o recurso externo';
  if (status === 'queued') return 'En cola · continuará en el próximo ciclo';
  if (status === 'paused') return 'Pausada · puede reanudarse';
  if (status === 'running') {
    if (nextAction.startsWith('execute:')) return 'Ejecutando paso · ' + String(mission?.next_action).slice(8);
    if (nextAction.startsWith('retry:')) return 'Reintentando paso · ' + String(mission?.next_action).slice(6);
    if (nextAction === 'next_ready_batch') return 'Continuando con el siguiente paso';
    return 'Ejecutando misión';
  }
  return 'Estado no determinado';
}
