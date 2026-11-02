const VOICE_LANGUAGE = 'es-PR';

export function cleanSpeechText(value) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' Código omitido. ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 imagen')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\*_\`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3200);
}

function normalizeVoicePhrase(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AFFIRMATIVE_MISSION_PHRASES = new Set([
  'si',
  'si comenzar',
  'si comenzar mision',
  'si comenzar la mision',
  'confirmo',
  'confirmar',
  'confirmar mision',
  'comenzar mision',
  'comenzar la mision',
  'iniciar mision',
  'iniciar la mision',
  'adelante',
  'hazlo',
  'procede',
  'de acuerdo'
]);

const NEGATIVE_MISSION_PHRASES = new Set([
  'no',
  'no comenzar',
  'no iniciar',
  'cancelar',
  'cancelar mision',
  'cancelar la mision',
  'solo conversar',
  'seguir conversando',
  'no comenzar mision'
]);

export function isVoiceMissionAffirmative(value) {
  return AFFIRMATIVE_MISSION_PHRASES.has(normalizeVoicePhrase(value));
}

export function isVoiceMissionNegative(value) {
  return NEGATIVE_MISSION_PHRASES.has(normalizeVoicePhrase(value));
}

export function speakAssistantText(value, host = window) {
  const spoken = cleanSpeechText(value);
  const synthesis = host?.speechSynthesis;
  const Utterance = host?.SpeechSynthesisUtterance;
  if (!spoken || !synthesis || typeof Utterance !== 'function' || typeof synthesis.speak !== 'function') {
    return false;
  }

  try {
    synthesis.cancel?.();
    const utterance = new Utterance(spoken);
    utterance.lang = VOICE_LANGUAGE;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 0.95;

    const voices = typeof synthesis.getVoices === 'function' ? synthesis.getVoices() : [];
    const spanishVoices = Array.isArray(voices)
      ? voices.filter(voice => String(voice?.lang ?? '').toLowerCase().startsWith('es'))
      : [];
    const selectedVoice = spanishVoices.find(voice => String(voice.lang).toLowerCase() === 'es-pr')
      || spanishVoices.find(voice => String(voice.lang).toLowerCase() === 'es-us')
      || spanishVoices.find(voice => String(voice.lang).toLowerCase() === 'es-mx')
      || spanishVoices.find(voice => String(voice.lang).toLowerCase() === 'es-es')
      || spanishVoices[0];
    if (selectedVoice) utterance.voice = selectedVoice;
    synthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopAssistantSpeech(host = window) {
  try {
    host?.speechSynthesis?.cancel?.();
  } catch {
    // Speech cancellation must never interrupt chat or authentication.
  }
}
