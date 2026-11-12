const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'pwa/src/index.css'), 'utf8');
const mobileCssStart = css.lastIndexOf('/* 2026-11-12 — compact Android layout');
assert.ok(mobileCssStart >= 0, 'mobile compact layout block must exist');
const mobileCss = css.slice(mobileCssStart);

function cssRule(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start >= 0, 'missing CSS rule: ' + selector);
  const end = source.indexOf('}', start);
  assert.ok(end > start, 'unterminated CSS rule: ' + selector);
  return source.slice(start, end + 1);
}

test('mobile Dashboard is a bounded viewport with one reachable vertical scroll owner', () => {
  const hardenedStart = css.lastIndexOf('/* 2026-11-12 — harden mobile scroll ownership');
  assert.ok(hardenedStart >= 0, 'explicit mobile scroll ownership override must exist');
  const hardened = css.slice(hardenedStart);
  const shell = cssRule(hardened, '.appShell{');
  const viewport = cssRule(hardened, '.screenViewport{');
  const dashboard = cssRule(hardened, '.dashboardScreen{');
  const home = cssRule(hardened, '.homeEssential{');
  const quickActions = cssRule(mobileCss, '.homeQuickActions{');
  const actionButton = cssRule(mobileCss, '.homeQuickActions button{');
  assert.ok(shell.includes('height:100dvh') && shell.includes('display:flex'));
  assert.ok(viewport.includes('flex:1 1 0') && viewport.includes('min-height:0'));
  assert.ok(dashboard.includes('overflow-y:auto'));
  assert.ok(dashboard.includes('touch-action:pan-y'));
  assert.ok(home.includes('overflow:visible'));
  assert.ok(quickActions.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
  assert.ok(actionButton.includes('min-height:44px'));
  assert.ok(app.includes('Estado de ARIA y de la misión actual.'));
});

test('mobile Chat compacts chrome while retaining a dedicated message-history scroller', () => {
  const chat = cssRule(mobileCss, '.chatPanel .chatWindow{');
  const composer = cssRule(mobileCss, '.chatPanel .composer textarea{');
  const send = cssRule(mobileCss, '.chatPanel .send{');
  const voice = cssRule(mobileCss, '.chatPanel .voiceModeToggle{');
  const telegram = cssRule(mobileCss, '.chatPanel .telegramSetupToggle{');
  assert.ok(chat.includes('min-height:0'));
  assert.ok(chat.includes('overflow-y:auto'));
  assert.ok(composer.includes('min-height:44px') && composer.includes('max-height:88px'));
  assert.ok(send.includes('width:44px') && send.includes('height:44px'));
  assert.ok(voice.includes('min-height:40px'));
  assert.ok(telegram.includes('min-height:40px'));
});

test('Chat opens and returns to the latest restored or newly appended message', () => {
  const start = app.indexOf('// Pin the active conversation to its newest message after history restore,');
  assert.ok(start >= 0, 'latest-message scroll effect must be documented');
  const end = app.indexOf('\n\n  useEffect(() => {', start + 10);
  assert.ok(end > start, 'latest-message scroll effect must be bounded');
  const effect = app.slice(start, end);
  assert.ok(effect.includes('if (!node || screen !== 1) return'));
  assert.ok(effect.includes('firstFrame = requestAnimationFrame'));
  assert.ok(effect.includes('secondFrame = requestAnimationFrame'));
  assert.ok(effect.includes('node.scrollTop = node.scrollHeight'));
  assert.ok(effect.includes('MutationObserver'));
  assert.ok(effect.includes('ResizeObserver'));
  assert.ok(effect.includes('observeChildren'));
  assert.ok(effect.includes('window.setTimeout(scrollLatest, 420)'));
  assert.ok(effect.includes('[screen, messages, sending]'));
  assert.ok(effect.includes('cancelAnimationFrame(firstFrame)'));
  assert.ok(effect.includes('cancelAnimationFrame(secondFrame)'));
  assert.ok(effect.includes('mutationObserver?.disconnect()'));
  assert.ok(effect.includes('resizeObserver?.disconnect()'));
});

test('long-form PWA screens retain their existing scroll containers', () => {
  assert.ok(css.includes('.pageBodyViewport{flex:1 1 auto;min-height:0;overflow:auto;'));
  assert.ok(css.includes('.projectBodyViewport{flex:1 1 0;min-height:0;min-width:0;overflow-x:hidden;overflow-y:auto;'));
});

test('remaining PWA sections use compact mobile density while preserving scroll', () => {
  const compactStart = css.lastIndexOf('/* 2026-11-12 — shared compact density for the remaining PWA sections.');
  assert.ok(compactStart >= 0);
  const compact = css.slice(compactStart);
  assert.ok(compact.includes('.pageBodyViewport{gap:8px;'));
  assert.ok(compact.includes('.capabilitiesViewport .capTabs{flex-wrap:nowrap;overflow-x:auto;'));
  assert.ok(compact.includes('.capabilitiesViewport .capGrid{grid-template-columns:repeat(2,minmax(0,1fr));'));
  assert.ok(compact.includes('.meditationViewport{gap:8px;}'));
  assert.ok(compact.includes('.settingsViewport{gap:8px;'));
  assert.ok(compact.includes('.projectBodyViewport>.panel{padding:10px;'));
  assert.ok(css.includes('.pageBodyViewport{flex:1 1 auto;min-height:0;overflow:auto;'));
  assert.ok(css.includes('.projectBodyViewport{flex:1 1 0;min-height:0;min-width:0;overflow-x:hidden;overflow-y:auto;'));
});
