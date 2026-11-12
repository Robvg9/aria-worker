import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pwa/src/index.css'), 'utf8');

test('mobile Dashboard keeps all content reachable inside its own vertical scroller', () => {
  assert.match(css, /\.homeEssential\{[\s\S]*?overflow-x:hidden;[\s\S]*?overflow-y:auto;/);
  assert.match(css, /\.homeEssential\{[\s\S]*?min-height:0;/);
  assert.match(css, /\.homeQuickActions\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(app, /Estado de ARIA y de la misión actual\./);
});

test('mobile Chat compacts chrome while retaining a dedicated message-history scroller', () => {
  assert.match(css, /\.chatPanel \.chatWindow\{[\s\S]*?overflow-y:auto;/);
  assert.match(css, /\.chatPanel \.chatWindow\{[\s\S]*?min-height:0;/);
  assert.match(css, /\.chatPanel \.composer textarea\{min-height:44px;max-height:88px/);
  assert.match(css, /\.chatPanel \.send\{width:44px;min-width:44px;height:44px/);
});

test('Chat opens and returns to the latest restored or newly appended message', () => {
  const start = app.indexOf('// Always open the active conversation at its newest message.');
  assert.ok(start >= 0, 'latest-message scroll effect must be documented');
  const end = app.indexOf('\n\n  useEffect(() => {', start + 10);
  assert.ok(end > start, 'latest-message scroll effect must be bounded');
  const effect = app.slice(start, end);
  assert.match(effect, /if \(!node \|\| screen !== 1\) return/);
  assert.match(effect, /requestAnimationFrame\(\(\) => \{/);
  assert.match(effect, /secondFrame = requestAnimationFrame/);
  assert.match(effect, /node\.scrollTop = node\.scrollHeight/);
  assert.match(effect, /\[screen, messages\.length, messages\[messages\.length - 1\]\?\.id, sending\]/);
  assert.match(effect, /cancelAnimationFrame\(firstFrame\)/);
  assert.match(effect, /cancelAnimationFrame\(secondFrame\)/);
});

test('long-form PWA screens retain their existing scroll containers', () => {
  assert.match(css, /\.pageBodyViewport\{[^}]*overflow:auto;/);
  assert.match(css, /\.projectBodyViewport\{[^}]*overflow-x:hidden;overflow-y:auto;/);
});
