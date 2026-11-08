export type NativeVoicePcmContext = {
  available: true;
  format: 'pcm_s16le';
  sampleRate: 16000;
  channels: 1;
  maxDurationMs: number;
  explicitActivationOnly: true;
  persisted: false;
  wakeWord: false;
};

export type NativeVoicePcmResponse = {
  format: 'pcm_s16le';
  sampleRate: 16000;
  channels: 1;
  durationMs: number;
  byteLength: number;
  audioBase64: string;
};

export type NativeVoiceBridge = {
  captureUtterance(input: { max_duration_ms: number }): Promise<NativeVoicePcmResponse>;
};

export const NATIVE_PCM_MAX_DURATION_MS = 8000;
export const NATIVE_PCM_MIN_DURATION_MS = 1000;
export const NATIVE_PCM_SAMPLE_RATE = 16000;
export const NATIVE_PCM_CHANNELS = 1;

export function getNativeVoiceContext(): (NativeVoicePcmContext & { bridge: NativeVoiceBridge }) | null;

export function hasNativeVoiceCapture(): boolean;

export function decodeBase64(base64: string): Uint8Array;

export function pcmToWavBytes(pcm: Uint8Array, sampleRate?: number, channels?: number): Uint8Array;

export function pcmToWavBlob(pcm: Uint8Array, sampleRate?: number, channels?: number): Blob;

export function captureNativeUtterance(maxDurationMs?: number): Promise<File>;
