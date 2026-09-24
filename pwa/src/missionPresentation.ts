const pad = (value: number) => String(Math.max(1, value)).padStart(2, '0');

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

  if (/battlecruiser/i.test(goal)) return 'Integración con BattleCruiser';
  if (/cuevacoin/i.test(goal)) return 'Operación CuevaCoin';
  if (/(credenciales|usuario|contraseña|password|login|sesión)/i.test(goal)) return 'Diagnóstico de acceso y credenciales';
  if (/(rwht|real world human|prueba)/i.test(goal)) return project === 'General' ? 'Prueba y verificación de ARIA' : `Prueba y verificación · ${project}`;
  if (/(dashboard|navegación|deslic|segunda pantalla|pantalla principal)/i.test(goal)) return 'Mejora de navegación de ARIA';
  if (/(notific|avisos)/i.test(goal)) return 'Mejora de notificaciones';
  if (/(chat)/i.test(goal)) return project === 'General' ? 'Mejora del chat de ARIA' : `Chat · ${project}`;
  if (/(android|pwa|aplicación|app)/i.test(goal)) return project === 'General' ? 'Mejora de la aplicación ARIA' : `Mejora de ${project}`;
  if (/mandale|manda(le)? un mensaje|env(í|i)a.*mensaje/i.test(goal)) return 'Envío de mensaje';
  return project === 'General' ? 'Misión de ARIA' : `Misión · ${project}`;
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
