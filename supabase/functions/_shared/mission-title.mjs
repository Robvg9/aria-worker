const MAX_MISSION_TITLE_LENGTH = 36;

function trimTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function compactMissionTitle(value) {
  const text = trimTitle(value);
  if (!text) return 'Misión de ARIA';
  if (text.length <= MAX_MISSION_TITLE_LENGTH) return text;
  const cut = text.slice(0, MAX_MISSION_TITLE_LENGTH - 1).trimEnd();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace >= 16 ? cut.slice(0, lastSpace) : cut) + '…';
}

export function deriveMissionDisplayTitle(goal, projectName = '') {
  const g = trimTitle(goal);
  const lower = g.toLowerCase();
  const project = trimTitle(projectName);
  let title = '';

  if (/battlecruiser/i.test(g)) title = 'Integración con BattleCruiser';
  else if (/cuevacoin/i.test(g)) title = 'Operación CuevaCoin';
  else if (/(notific|avisos)/i.test(g)) title = 'Mejora de notificaciones';
  else if (/(dashboard|panel|navegación|navegacion)/i.test(g)) title = 'Mejora del panel de ARIA';
  else if (/(human gate|aprobación humana|aprobacion humana)/i.test(g)) title = 'Revisión con Human Gate';
  else if (/(diagn[oó]stico|diagnostica|diagnosticar)/i.test(g)) title = 'Diagnóstico operativo de ARIA';
  else if (/(crear|cree|crea)\b.*\b(aplicación|aplicacion|app|pwa|página|pagina|panel|interfaz)/i.test(g)) title = 'Crear un artefacto en ARIA';
  else if (/(repara|reparar|arregla|arreglar|corrige|corregir|resolver|resuelve|soluciona|solucionar)/i.test(g)) title = 'Reparación de ARIA';
  else if (/(prueba|probar|verifica|verificar)/i.test(g)) title = project ? 'Prueba de ' + project : 'Prueba de ARIA';
  else if (/(meditation|meditación|misi[oó]n)/i.test(lower)) title = 'Trabajo autónomo de ARIA';
  else {
    const sentence = g.split(/[.!?\n]/)[0];
    title = sentence || g;
  }

  return compactMissionTitle(title);
}

export const MISSION_TITLE_VERSION = 'aria-mission-title-v1';
