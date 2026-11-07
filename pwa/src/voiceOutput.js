import { appendVoiceDiagnostic } from './voiceDiagnostics.js';

const VOICE_LANGUAGE = 'es-PR';
const VOICE_OUTPUT_START_EVENT = 'aria-voice-output-start';
const VOICE_OUTPUT_END_EVENT = 'aria-voice-output-end';
let speechSequence = 0;

function recordSpeechDiagnostic(event, details = {}, diagnosticHost = {}) {
  try {
    appendVoiceDiagnostic(event, details, diagnosticHost);
  } catch {
    // Diagnostics must never prevent speech output.
  }
}

function emitVoiceOutputEvent(host, eventName) {
  try {
    if (typeof host?.dispatchEvent === 'function' && typeof Event === 'function') {
      host.dispatchEvent(new Event(eventName));
    }
  } catch {
    // Voice focus events are advisory; speech itself must remain independent.
  }
}

export function cleanSpeechText(value) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' Código omitido. ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 imagen')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\*_\`>#~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
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
  'no solo conversar',
  'seguir conversando',
  'no comenzar mision'
]);

export function isVoiceMissionAffirmative(value) {
  return AFFIRMATIVE_MISSION_PHRASES.has(normalizeVoicePhrase(value));
}

export function isVoiceMissionNegative(value) {
  return NEGATIVE_MISSION_PHRASES.has(normalizeVoicePhrase(value));
}

export function speakAssistantText(value, host = window, diagnosticHost = {}) {
  const spoken = cleanSpeechText(value);
  const synthesis = host?.speechSynthesis;
  const Utterance = host?.SpeechSynthesisUtterance;
  if (!spoken) return false;
  if (!synthesis || typeof Utterance !== 'function' || typeof synthesis.speak !== 'function') {
    recordSpeechDiagnostic('speech_api_missing', { reason: 'speech_synthesis_unsupported' }, diagnosticHost);
    return false;
  }

  recordSpeechDiagnostic('speech_output_requested', { chars: spoken.length }, diagnosticHost);
  const sequence = ++speechSequence;
  try {
    synthesis.cancel?.();
    emitVoiceOutputEvent(host, VOICE_OUTPUT_START_EVENT);
    const utterance = new Utterance(spoken);
    const finish = (event, details = {}) => {
      if (sequence === speechSequence) {
        recordSpeechDiagnostic(event, details, diagnosticHost);
        emitVoiceOutputEvent(host, VOICE_OUTPUT_END_EVENT);
      }
    };
    utterance.onstart = () => {
      if (sequence === speechSequence) {
        recordSpeechDiagnostic('speech_output_started', {
          voice_available: Boolean(selectedVoice),
          voice_count: spanishVoices.length
        }, diagnosticHost);
      }
    };
    utterance.onend = () => finish('speech_output_ended');
    utterance.onerror = event => finish('speech_output_error', {
      error: String(event?.error || 'unknown')
    });
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
    recordSpeechDiagnostic('speech_utterance_queued', {
      chars: spoken.length,
      voice_available: Boolean(selectedVoice)
    }, diagnosticHost);
    synthesis.speak(utterance);
    return true;
  } catch (error) {
    recordSpeechDiagnostic('speech_output_start_failed', {
      error_code: String(error?.name || 'unknown')
    }, diagnosticHost);
    if (sequence === speechSequence) emitVoiceOutputEvent(host, VOICE_OUTPUT_END_EVENT);
    return false;
  }
}

export function stopAssistantSpeech(host = window, diagnosticHost = {}) {
  speechSequence += 1;
  recordSpeechDiagnostic('speech_output_cancelled', {}, diagnosticHost);
  try {
    host?.speechSynthesis?.cancel?.();
  } catch {
    // Speech cancellation must never interrupt chat or authentication.
  }
  emitVoiceOutputEvent(host, VOICE_OUTPUT_END_EVENT);
}
