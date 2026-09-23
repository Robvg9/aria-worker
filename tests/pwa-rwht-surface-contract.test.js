'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'pwa', 'src', 'App.tsx');
const projectPath = path.join(__dirname, '..', 'pwa', 'src', 'ProjectWorkspace.tsx');
const app = fs.readFileSync(appPath, 'utf8');
const project = fs.readFileSync(projectPath, 'utf8');

assert.match(
  app,
  /if \/\^\\\*\[\\s\\S\]\+\\\*\$\/\.test\(part\) return <strong/,
  'Single-asterisk markdown must render as bold.'
);

assert.match(
  app,
  /function MissionDetail\(\{ mission, events, onClose \}/,
  'MissionDetail component must exist.'
);

assert.match(
  app,
  /mission\.block_details && \(status === 'blocked' \|\| status === 'waiting'/,
  'Blocked mission details must remain visible in MissionDetail.'
);

assert.match(
  app,
  /BLOQUEADAS[\s\S]*openMission\(b\.mission_id\)/,
  'Blocked missions must be directly openable from Meditation IA.'
);

assert.match(app, /<ProjectWorkspace/, 'App must integrate ProjectWorkspace.');
assert.match(app, /openNewMissionSignal/, 'Chat must accept the cross-page New Mission request signal.');
assert.match(app, /api\('\/conversation', session\.accessToken\)/, 'Chat must restore persisted general conversation history.');
assert.match(app, /onMission=\{\(\) => \{ setPage\('aria'\); setOpenNewMissionSignal/, 'Capabilities New Mission control must actually request the New Mission modal.');
assert.match(project, /function VisualBoard/, 'ARTIA VisualBoard must exist.');
assert.match(project, /createMission/, 'ARTIA must support mission creation from the visual workspace.');
assert.match(project, /project_id/, 'Project context must be attached to chat/mission operations.');
assert.match(project, /annotation_summary/, 'Structured visual annotations must be persisted/forwarded.');
assert.match(project, /<canvas/, 'ARTIA must render a real canvas surface.');
assert.match(project, /previewPaused/,'Project ARTIA must support pausing the project preview before drawing.');
assert.match(project, /project_preview:true/,'Project ARTIA must tag visual mission/chat context as project preview work.');

assert.doesNotMatch(
  app,
  /onTouchStart=\{onTouchStart\}|onTouchEnd=\{onTouchEnd\}/,
  'PWA must not reference removed undefined touch handlers.'
);
assert.match(app,/onPointerDown=\{onSwipeStart\}/,'PWA must implement guarded horizontal pointer navigation.');
assert.match(app,/screenIndicator/,'PWA must expose the two-screen navigation indicator.');

assert.match(
  app,
  /className='send' aria-label=\{sending \? 'Enviando mensaje' : 'Enviar mensaje'\}/,
  'Chat send control must expose a clear accessible label.'
);

assert.match(
  app,
  /className='fileChip'>\{file\.name\}<button aria-label='Quitar archivo adjunto'/,
  'Attachment removal control must expose a clear accessible label.'
);

assert.match(
  fs.readFileSync(path.join(__dirname, '..', 'pwa', 'src', 'index.css'), 'utf8'),
  /\.pwaShell\{padding-bottom:calc\(74px \+ env\(safe-area-inset-bottom\)\);\}/,
  'Mobile PWA shell must reserve space for the fixed bottom navigation.'
);

console.log('pwa-rwht-surface-contract PASS');
