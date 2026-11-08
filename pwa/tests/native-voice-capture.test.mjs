import test from "node:test";
import assert from "node:assert/strict";
import {
  captureNativeUtterance,
  decodeBase64,
  getNativeVoiceContext,
  pcmToWavBytes
} from "../src/nativeVoiceCapture.js";

const pcm = Uint8Array.from([0, 1, 2, 3, 250, 251, 252, 253]);
const base64 = Buffer.from(pcm).toString("base64");

function installWindow(overrides = {}) {
  const bridge = {
    captureUtterance: async (input) => {
      assert.deepEqual(input, { max_duration_ms: 5000 });
      return {
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        durationMs: 5000,
        byteLength: pcm.length,
        audioBase64: base64
      };
    },
    ...overrides.bridge
  };
  globalThis.window = {
    ariaVoiceV4: bridge,
    __ariaVoiceV4NativeContext: {
      voice: {
        wakeWord: false,
        pcm: {
          available: true,
          format: "pcm_s16le",
          sampleRate: 16000,
          channels: 1,
          maxDurationMs: 8000,
          explicitActivationOnly: true,
          persisted: false
        }
      },
      ...overrides.context
    }
  };
  return () => {
    delete globalThis.window;
  };
}

test("native PCM context requires explicit, non-persisted, wake-word-off capture", () => {
  const restore = installWindow();
  try {
    assert.ok(getNativeVoiceContext());
  } finally {
    restore();
  }

  for (const patch of [
    { voice: { wakeWord: true, pcm: { available: true, format: "pcm_s16le", sampleRate: 16000, channels: 1, explicitActivationOnly: true, persisted: false } } },
    { voice: { wakeWord: false, pcm: { available: true, format: "pcm_s16le", sampleRate: 16000, channels: 1, explicitActivationOnly: false, persisted: false } } },
    { voice: { wakeWord: false, pcm: { available: true, format: "pcm_s16le", sampleRate: 16000, channels: 1, explicitActivationOnly: true, persisted: true } } },
    { voice: { wakeWord: false, pcm: { available: true, format: "pcm_f32le", sampleRate: 16000, channels: 1, explicitActivationOnly: true, persisted: false } } }
  ]) {
    const restoreInvalid = installWindow({ context: patch });
    try {
      assert.equal(getNativeVoiceContext(), null);
    } finally {
      restoreInvalid();
    }
  }
});

test("base64 decoding rejects malformed payloads", () => {
  assert.deepEqual(Array.from(decodeBase64(base64)), Array.from(pcm));
  assert.throws(() => decodeBase64("abc"), /voice_pcm_base64_invalid/);
  assert.throws(() => decodeBase64(""), /voice_pcm_base64_invalid/);
});

test("PCM is wrapped in a valid 16 kHz mono WAV container", () => {
  const wav = pcmToWavBytes(pcm);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (start, end) => String.fromCharCode(...wav.slice(start, end));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + pcm.length);
  assert.equal(ascii(8, 12), "WAVE");
  assert.equal(ascii(12, 16), "fmt ");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 40), "data");
  assert.equal(view.getUint32(40, true), pcm.length);
  assert.deepEqual(Array.from(wav.slice(44)), Array.from(pcm));
});

test("native capture returns a WAV File only after a valid bounded response", async () => {
  const restore = installWindow();
  try {
    const file = await captureNativeUtterance(5000);
    assert.equal(file.name.startsWith("aria-native-audio-"), true);
    assert.equal(file.type, "audio/wav");
    assert.equal(file.size, 44 + pcm.length);
    const bytes = new Uint8Array(await file.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  } finally {
    restore();
  }
});

test("native capture fails closed on mismatched or oversized responses", async () => {
  let restore = installWindow();
  try {
    await assert.rejects(
      captureNativeUtterance(500),
      /voice_pcm_duration_invalid/
    );
  } finally {
    restore();
  }

  restore = installWindow({
    bridge: {
      captureUtterance: async () => ({
        format: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
        durationMs: 5000,
        byteLength: pcm.length + 1,
        audioBase64: base64
      })
    }
  });
  try {
    await assert.rejects(captureNativeUtterance(5000), /voice_pcm_size_invalid|voice_pcm_payload_mismatch/);
  } finally {
    restore();
  }

  const saved = globalThis.window;
  delete globalThis.window;
  try {
    await assert.rejects(captureNativeUtterance(5000), /voice_pcm_unavailable/);
  } finally {
    globalThis.window = saved;
    delete globalThis.window;
  }
});
