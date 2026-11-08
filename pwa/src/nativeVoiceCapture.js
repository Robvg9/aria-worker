const MAX_DURATION_MS = 8000;
const MIN_DURATION_MS = 1000;
const SAMPLE_RATE = 16000;
const CHANNELS = 1;

function win() {
  return typeof globalThis !== 'undefined' ? globalThis.window : undefined;
}

export function getNativeVoiceContext() {
  const current = win();
  const bridge = current && current.ariaVoiceV4;
  const context = current && current.__ariaVoiceV4NativeContext;
  const voice = context && context.voice;
  const pcm = voice && voice.pcm;
  if (!pcm || pcm.available !== true || pcm.explicitActivationOnly !== true
      || pcm.persisted !== false || voice.wakeWord !== false) return null;
  if (pcm.format !== 'pcm_s16le' || pcm.sampleRate !== SAMPLE_RATE || pcm.channels !== CHANNELS) return null;
  if (!bridge || typeof bridge.captureUtterance !== 'function') return null;
  return { ...pcm, bridge };
}

export function hasNativeVoiceCapture() {
  return getNativeVoiceContext() !== null;
}

export function decodeBase64(base64) {
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length % 4 !== 0) {
    throw new Error('voice_pcm_base64_invalid');
  }
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function pcmToWavBytes(pcm, sampleRate = SAMPLE_RATE, channels = CHANNELS) {
  if (!(pcm instanceof Uint8Array) || pcm.length === 0) throw new Error('voice_pcm_audio_invalid');
  if (pcm.length > MAX_DURATION_MS * 32) throw new Error('voice_pcm_audio_too_large');
  if (sampleRate !== SAMPLE_RATE || channels !== CHANNELS) throw new Error('voice_pcm_format_unsupported');
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.length, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

export function pcmToWavBlob(pcm, sampleRate = SAMPLE_RATE, channels = CHANNELS) {
  return new Blob([pcmToWavBytes(pcm, sampleRate, channels)], { type: 'audio/wav' });
}

function validateResponse(response, maxDurationMs) {
  if (!response || typeof response !== 'object') throw new Error('voice_pcm_response_invalid');
  if (response.format !== 'pcm_s16le' || response.sampleRate !== SAMPLE_RATE
      || response.channels !== CHANNELS) throw new Error('voice_pcm_response_invalid');
  if (!Number.isSafeInteger(response.durationMs) || response.durationMs <= 0
      || response.durationMs > maxDurationMs + 250) throw new Error('voice_pcm_duration_invalid');
  if (!Number.isSafeInteger(response.byteLength) || response.byteLength <= 0
      || response.byteLength > MAX_DURATION_MS * 32) throw new Error('voice_pcm_size_invalid');
  if (typeof response.audioBase64 !== 'string'
      || response.audioBase64.length !== Math.ceil(response.byteLength / 3) * 4) {
    throw new Error('voice_pcm_size_invalid');
  }
  return response;
}

export async function captureNativeUtterance(maxDurationMs = 5000) {
  if (!Number.isSafeInteger(maxDurationMs)
      || maxDurationMs < MIN_DURATION_MS || maxDurationMs > MAX_DURATION_MS) {
    throw new Error('voice_pcm_duration_invalid');
  }
  const context = getNativeVoiceContext();
  if (!context) throw new Error('voice_pcm_unavailable');
  const response = validateResponse(
    await context.bridge.captureUtterance({ max_duration_ms: maxDurationMs }),
    maxDurationMs
  );
  const bytes = decodeBase64(response.audioBase64);
  if (bytes.length !== response.byteLength) throw new Error('voice_pcm_payload_mismatch');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return new File([pcmToWavBlob(bytes)], 'aria-native-audio-' + stamp + '.wav', { type: 'audio/wav' });
}
