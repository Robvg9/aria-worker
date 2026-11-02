const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const project = fs.readFileSync(path.join(root, 'pwa/src/ProjectWorkspace.tsx'), 'utf8');
const voice = fs.readFileSync(path.join(root, 'pwa/src/VoiceInputButton.tsx'), 'utf8');
const handsFree = fs.readFileSync(path.join(root, 'pwa/src/HandsFreeVoiceControl.tsx'), 'utf8');
const wakeWordSource = fs.readFileSync(path.join(root, 'pwa/src/voiceWakeWord.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pwa/src/index.css'), 'utf8');

assert.match(voice, /SpeechRecognitionConstructor/);
assert.match(voice, /webkitSpeechRecognition/);
assert.match(voice, /recognition\.lang = 'es-PR'/);
assert.match(voice, /recognition\.onresult/);
assert.match(voice, /onTranscriptRef\.current\(transcript\)/);
assert.match(voice, /navigator\.mediaDevices\?\.getUserMedia/);
assert.match(voice, /new MediaRecorder\(/);
assert.match(voice, /onAudioRef\.current\?\.\(session\.audioFile\)/);
assert.match(voice, /Audio adjuntado y transcripción insertada/);
assert.match(voice, /Permite el acceso al micrófono/);
assert.match(voice, /transcripción automática por voz/);
assert.match(voice, /Revísala y envíala/);
assert.equal((app.match(/<VoiceInputButton/g) || []).length, 3, 'main chat, create mission, and idea analyzer must support voice');
assert.equal((project.match(/<VoiceInputButton/g) || []).length, 3, 'project chat, project mission, and ARTIA instruction must support voice');
assert.match(app, /VoiceInputButton\s+captureAudio=\{!voiceMode\}\s+autoSubmit=\{voiceMode\}\s+onAudio=\{setAudioFile\}/, 'main chat keeps optional audio attachments while voice mode auto-sends the transcript');
assert.match(app, /for \(const attachment of attachments\)/, 'main chat must upload audio alongside normal attachments');
assert.match(app, /VoiceInputButton captureAudio onAudio=\{setMissionAudioFile\}/, 'mission creation must record and attach its audio');
assert.match(app, /VoiceInputButton captureAudio onAudio=\{setIdeaAudioFile\}/, 'Meditation IA idea analysis must record and attach its audio');
assert.equal((app.match(/<VoiceInputButton captureAudio/g) || []).length, 2, 'mission and idea surfaces retain audio attachments; voice chat uses transcript-only mode');
assert.match(app, /captureAudio=\{!voiceMode\}/, 'voice chat does not upload a second copy of audio');
assert.match(app, /audio_attachments: audioAttachments/, 'main mission request must send uploaded audio metadata');
assert.match(app, /audio_transcript: clean/, 'mission and idea requests must include the transcribed text');

assert.match(project, /VoiceInputButton captureAudio onAudio=\{setAudioFile\}/, 'project chat must attach the original audio file');
assert.match(project, /VoiceInputButton captureAudio onAudio=\{setMissionAudioFile\}/, 'project mission creation must record and attach audio');
assert.match(project, /VoiceInputButton captureAudio onAudio=\{setInstructionAudioFile\}/, 'ARTIA visual instructions must record and attach audio');
assert.equal((project.match(/<VoiceInputButton captureAudio/g) || []).length, 3, 'all three project AI input surfaces must record original audio');
assert.match(project, /api\('\/media\/upload-url'/, 'project chat and mission/visual sends must upload the recorded audio before sending');
assert.match(project, /audio_attachments:audioAttachment\?\[audioAttachment\]:\[\]/, 'ARTIA-created missions must forward audio metadata');
assert.match(project, /parts\.push\(\{type:'file',fileId:audioAttachment\.path/, 'ARTIA chat must attach the original audio file alongside the visual');
assert.match(project, /audio_attachments:audioAttachments/, 'project mission request must send uploaded audio metadata');

const api = fs.readFileSync(path.join(root, 'supabase/functions/aria-app-api-v3/index.ts'), 'utf8');
assert.match(api, /function normalizeAudioAttachments\(userId: string, raw: any\)/, 'backend must validate and normalize audio references');
assert.match(api, /validPath = storagePath\.startsWith\(userId \+ "\/"\)/, 'audio metadata must only reference objects owned by the authenticated user');
assert.match(api, /audio_attachments:audioAttachments/, 'canonical mission metadata must preserve audio references');
assert.match(api, /audio_attachments:Array\.isArray\(row\.metadata\?\.audio_attachments\)/, 'Meditation IA proposals must retain audio references');

const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');
assert.match(runner, /audio_attachments: Array\.isArray\(mission\?\.metadata\?\.audio_attachments\)/, 'mission audio references must survive the intake-to-planner handoff');
assert.match(runner, /audio_transcript: typeof mission\?\.metadata\?\.audio_transcript === "string"/, 'the mission planner must receive the automatic transcript');
assert.match(css, /\.voiceInputButton/);
assert.match(css, /\.voiceInputNotice/);
assert.match(css, /\.voicePromptField/);
assert.match(css, /\.visualInstructionComposer/);
assert.match(app, /<HandsFreeVoiceControl onTranscript=\{handleVoiceTranscript\}/, 'voice mode must expose the foreground hands-free listener');
assert.match(app, /disabled=\{sending \|\| handsFreeActive\}/, 'push-to-talk must be disabled while hands-free recognition is active');
assert.match(handsFree, /recognition\.continuous = true/, 'hands-free mode must continuously recognize speech while enabled');
assert.match(handsFree, /recognition\.interimResults = true/, 'hands-free mode must consume partial recognition events');
assert.match(handsFree, /recognition\.lang = 'es-PR'/, 'hands-free mode must use Puerto Rican Spanish recognition');
assert.match(handsFree, /extractWakeWordRemainder/, 'hands-free mode must require the ARIA wake phrase before capturing a command');
assert.match(handsFree, /appendVoiceDiagnostic/, 'hands-free voice must retain local diagnostics for browser and recognition failures');
assert.match(handsFree, /No guarda audio ni transcripciones/, 'voice diagnostics must explicitly avoid storing audio and recognized speech');
assert.match(handsFree, /Copiar diagnóstico/, 'the user must be able to export local voice diagnostics without granting audio access');
assert.match(handsFree, /SILENCE_TO_SEND_MS = 1650/, 'hands-free mode must submit after a bounded pause in speech');
assert.match(handsFree, /document\.addEventListener\('visibilitychange'/, 'hands-free listening must pause when the PWA is backgrounded');
assert.match(handsFree, /window\.addEventListener\('pagehide'/, 'hands-free listening must stop when the PWA is closed or navigated away');
assert.match(handsFree, /wakeLockApi\.request\('screen'\)/, 'hands-free mode should request a screen wake lock while foregrounded when supported');
assert.match(handsFree, /aria-voice-output-start/, 'recognition must pause while ARIA speaks');
assert.match(handsFree, /aria-voice-output-end/, 'recognition must resume after ARIA finishes speaking');
assert.match(handsFree, /Detener la voz de ARIA/, 'the user must be able to interrupt spoken output even while the microphone is muted');
assert.match(handsFree, /stopAssistantSpeech\(\)/, 'the visible silence action must cancel current speech synthesis');
assert.ok(wakeWordSource.includes('aria(?:'), 'wake phrase matcher must explicitly use ARIA');

assert.match(app, /VOICE_MODE_KEY = 'aria_voice_conversation_mode_v1'/, 'voice mode preference must persist locally per device');
assert.match(app, /speakAssistantText\(p\.text\)/, 'assistant replies must be spoken while voice mode is enabled');
assert.match(app, /isVoiceMissionAffirmative\(transcript\)/, 'spoken affirmative must only be handled inside the pending mission confirmation gate');
assert.match(app, /isVoiceMissionNegative\(transcript\)/, 'spoken cancellation must be handled inside the pending mission confirmation gate');
assert.match(app, /No reconocí una confirmación clara/, 'ambiguous speech must stay in the pending confirmation flow instead of being sent as a new command');
assert.match(app, /return send\(transcript\)/, 'voice mode must await the final recognized transcript response');
assert.match(voice, /autoSubmit = false/, 'voice input must preserve manual review mode outside voice conversation');
assert.ok(voice.includes('Transcripción recibida. ARIA está preparando tu respuesta'), 'automatic voice mode must announce response processing');
assert.ok(voice.includes('Respuesta recibida. Puedes hablar de nuevo.'), 'voice processing notice must resolve when the assistant reply arrives');
assert.match(voice, /Promise\.resolve\(\)[\s\S]*onTranscriptRef\.current\(transcript\)/, 'voice mode must await completion of the assistant turn');
assert.match(app, /voice_mode: voiceModeRef\.current/, 'voice chat must explicitly request its low-latency backend path');
assert.match(app, /return send\(transcript\)/, 'voice input must await the assistant response result');
assert.match(voice, /disabled = false/, 'voice input must support a busy-state guard');
assert.ok(app.includes('disabled={sending}'), 'chat must prevent overlapping voice submissions');
assert.match(css, /\.voiceModeToggle/, 'PWA must expose the voice mode control');
assert.match(app, /voiceModePrivacyNote/, 'PWA must disclose that the browser may process audio for recognition');

(async () => {
  const voiceOutput = await import(pathToFileURL(path.join(root, 'pwa/src/voiceOutput.js')).href);
  const wakeWord = await import(pathToFileURL(path.join(root, 'pwa/src/voiceWakeWord.js')).href);
  const voiceDiagnostics = await import(pathToFileURL(path.join(root, 'pwa/src/voiceDiagnostics.js')).href);
  const diagnosticStorage = {
    value: null,
    getItem(key) { return key === 'aria_voice_diagnostics_v1' ? this.value : null; },
    setItem(key, value) { if (key === 'aria_voice_diagnostics_v1') this.value = value; },
    removeItem(key) { if (key === 'aria_voice_diagnostics_v1') this.value = null; }
  };
  const diagnosticResult = voiceDiagnostics.appendVoiceDiagnostic('wake_match', {
    phrase_chars: 21,
    command_chars: 12,
    wake_matched: true,
    transcript: 'PRIVATE WORDS MUST NOT BE STORED'
  }, {
    storage: diagnosticStorage,
    window: { SpeechRecognition: function FakeRecognition() {} },
    navigator: { permissions: { query() {} }, mediaDevices: { getUserMedia() {} } },
    document: { hidden: false },
    secureContext: true,
    now: 1793644447000
  });
  assert.equal(diagnosticResult.persisted, true, 'voice diagnostics must persist metadata locally');
  assert.equal(diagnosticResult.record.environment.recognition_api, 'standard');
  assert.equal(diagnosticResult.record.environment.secure_context, true);
  assert.equal(diagnosticResult.record.environment.page_visible, true);
  assert.equal(Object.hasOwn(diagnosticResult.record.details, 'transcript'), false, 'raw recognized speech must never be retained');
  assert.equal(JSON.stringify(voiceDiagnostics.readVoiceDiagnostics({ storage: diagnosticStorage })).includes('PRIVATE WORDS'), false);
  assert.equal(voiceDiagnostics.appendVoiceDiagnostic('unknown_event', {}, { storage: diagnosticStorage }).persisted, false, 'unknown diagnostic events must be rejected');
  for (let i = 0; i < 65; i += 1) {
    voiceDiagnostics.appendVoiceDiagnostic('recognition_end', {}, { storage: diagnosticStorage, now: 1793644447000 + i });
  }
  assert.equal(voiceDiagnostics.readVoiceDiagnostics({ storage: diagnosticStorage }).length, 60, 'diagnostic retention must be bounded');
  assert.equal(voiceDiagnostics.clearVoiceDiagnostics({ storage: diagnosticStorage }), true);
  assert.equal(voiceDiagnostics.readVoiceDiagnostics({ storage: diagnosticStorage }).length, 0);
  assert.equal(wakeWord.extractWakeWordRemainder('Oye ARIA, ¿cómo estás?'), 'como estas');
  assert.equal(wakeWord.extractWakeWordRemainder('ARIA'), '');
  assert.equal(wakeWord.extractWakeWordRemainder('Hablame de economia'), null, 'incidental speech must not activate hands-free mode');
  assert.equal(wakeWord.extractWakeWordRemainder('Malaria, abre el navegador'), null, 'the word Malaria must not be accepted as the ARIA wake word');
  assert.equal(wakeWord.extractWakeWordRemainder('María, abre el navegador'), null, 'the name María must not be accepted as the ARIA wake word');
  assert.equal(wakeWord.extractWakeWordRemainder('Área, abre el navegador'), null, 'the word área must not be accepted as the ARIA wake word');
  assert.equal(wakeWord.extractWakeWordRemainder('Hey ARIA, deja de escuchar'), 'deja de escuchar');
  assert.equal(wakeWord.classifyHandsFreeCommand('deja de escuchar'), 'stop-listening');
  assert.equal(wakeWord.classifyHandsFreeCommand('apaga el micrófono'), 'stop-listening');
  assert.equal(wakeWord.classifyHandsFreeCommand('silencio'), 'stop-speaking');
  assert.equal(wakeWord.classifyHandsFreeCommand('hola mundo'), null);
  assert.equal(voiceOutput.cleanSpeechText('**Hola** [ARIA](https://aria.example)'), 'Hola ARIA');
  assert.equal(voiceOutput.cleanSpeechText('Consulta https://example.com ahora'), 'Consulta ahora');
  assert.equal(voiceOutput.isVoiceMissionAffirmative('Sí, comenzar la misión.'), true);
  assert.equal(voiceOutput.isVoiceMissionAffirmative('Sí, quizás después.'), false, 'ambiguous speech must never approve a mission');
  assert.equal(voiceOutput.isVoiceMissionNegative('No, solo conversar.'), true);
  assert.equal(voiceOutput.isVoiceMissionNegative('No estoy seguro.'), false, 'ambiguous speech must not dismiss a mission');
  assert.equal(voiceOutput.isVoiceMissionAffirmative('adelante'), true);

  const spoken = [];
  let cancelCount = 0;
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const voiceEvents = [];
  const fakeHost = {
    dispatchEvent(event) { voiceEvents.push(event.type); return true; },
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() { cancelCount += 1; },
      getVoices() { return [{ lang: 'es-MX', name: 'Spanish Latin America' }, { lang: 'en-US', name: 'English' }]; },
      speak(utterance) { spoken.push(utterance); }
    }
  };
  assert.equal(voiceOutput.speakAssistantText('Hola **Robert**.', fakeHost), true);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Hola Robert.');
  assert.equal(spoken[0].lang, 'es-PR');
  assert.equal(spoken[0].voice.lang, 'es-MX');
  assert.ok(voiceEvents.includes('aria-voice-output-start'), 'TTS start must notify the hands-free controller');
  spoken[0].onend();
  assert.ok(voiceEvents.includes('aria-voice-output-end'), 'TTS completion must allow hands-free listening to resume');
  voiceOutput.stopAssistantSpeech(fakeHost);
  assert.equal(cancelCount, 2, 'speech can be cancelled when voice mode is disabled or the chat unmounts');
  assert.equal(voiceOutput.speakAssistantText('   ', fakeHost), false);
  assert.equal(voiceOutput.speakAssistantText('Hola', {}), false, 'missing browser speech APIs must fail safely');

  console.log('PWA AUDIO + ARIA VOICE CONVERSATION + SPEECH OUTPUT CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
