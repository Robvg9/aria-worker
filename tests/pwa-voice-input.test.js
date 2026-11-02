const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const project = fs.readFileSync(path.join(root, 'pwa/src/ProjectWorkspace.tsx'), 'utf8');
const voice = fs.readFileSync(path.join(root, 'pwa/src/VoiceInputButton.tsx'), 'utf8');
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
assert.equal((app.match(/<VoiceInputButton captureAudio/g) || []).length, 3, 'all three main PWA AI input surfaces must record original audio, not dictation only');
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

assert.match(app, /VOICE_MODE_KEY = 'aria_voice_conversation_mode_v1'/, 'voice mode preference must persist locally per device');
assert.match(app, /speakAssistantText\(p\.text\)/, 'assistant replies must be spoken while voice mode is enabled');
assert.match(app, /isVoiceMissionAffirmative\(transcript\)/, 'spoken affirmative must only be handled inside the pending mission confirmation gate');
assert.match(app, /isVoiceMissionNegative\(transcript\)/, 'spoken cancellation must be handled inside the pending mission confirmation gate');
assert.match(app, /void send\(transcript\)/, 'voice mode must submit the final recognized transcript automatically');
assert.match(voice, /autoSubmit = false/, 'voice input must preserve manual review mode outside voice conversation');
assert.match(voice, /Transcripción recibida\\. Procesando voz/, 'automatic voice mode must announce voice processing');
assert.match(voice, /disabled = false/, 'voice input must support a busy-state guard');
assert.match(app, /disabled=\\{sending\\}/, 'chat must prevent overlapping voice submissions');
assert.match(css, /\.voiceModeToggle/, 'PWA must expose the voice mode control');
assert.match(app, /voiceModePrivacyNote/, 'PWA must disclose that the browser may process audio for recognition');

(async () => {
  const voiceOutput = await import(pathToFileURL(path.join(root, 'pwa/src/voiceOutput.js')).href);
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
  const fakeHost = {
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
  voiceOutput.stopAssistantSpeech(fakeHost);
  assert.equal(cancelCount, 2, 'speech can be cancelled when voice mode is disabled or the chat unmounts');
  assert.equal(voiceOutput.speakAssistantText('   ', fakeHost), false);
  assert.equal(voiceOutput.speakAssistantText('Hola', {}), false, 'missing browser speech APIs must fail safely');

  console.log('PWA AUDIO + ARIA VOICE CONVERSATION + SPEECH OUTPUT CONTRACT: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
