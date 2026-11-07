const WAKE_PREFIX = /^(?:(?:oye|hey|hola|ok|okay)\s+)?aria(?:\s*[,;:]\s*|\s+|$)/;

// Prefer the device's configured Spanish dialect. Some browser speech engines
// reject es-CU/es-PR; callers may then retry with the broadly supported es-ES.
export function resolveVoiceRecognitionLocale(primaryLanguage, preferredLanguages = []) {
  const candidates = [primaryLanguage, ...(Array.isArray(preferredLanguages) ? preferredLanguages : [])];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const locale = candidate.trim().replace(/_/g, '-');
    if (/^es(?:-[A-Za-z0-9]{2,8})*$/i.test(locale)) return locale;
  }
  return 'es-ES';
}


export function normalizeWakeSpeech(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns null when the activation phrase is absent; otherwise returns the
// words spoken after "ARIA". Detection is deliberately limited to the start
// of a recognized utterance to avoid activating on incidental mentions.
export function extractWakeWordRemainder(value) {
  const normalized = normalizeWakeSpeech(value);
  const match = normalized.match(WAKE_PREFIX);
  if (!match) return null;
  return normalized.slice(match[0].length).trim();
}

export function classifyHandsFreeCommand(value) {
  const phrase = normalizeWakeSpeech(value);
  if (/^(?:deja de escuchar|deja de oir|apaga(?:r)? (?:el )?microfono|detener (?:la )?escucha|parar (?:la )?escucha|pausar (?:la )?escucha|desactiva(?:r)? (?:el )?manos libres)$/.test(phrase)) {
    return 'stop-listening';
  }
  if (/^(?:silencio|callate|deja de hablar|para de hablar|deten (?:la )?voz)$/.test(phrase)) {
    return 'stop-speaking';
  }
  return null;
}
