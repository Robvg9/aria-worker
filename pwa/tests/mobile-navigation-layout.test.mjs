import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

test('mobile PWA navigation keeps all seven destinations reachable on narrow screens', () => {
  assert.match(css, /\.bottomNav\{[^}]*grid-template-columns:repeat\(7,minmax\(48px,1fr\)\)/);
  assert.match(css, /\.bottomNav\{[^}]*overflow-x:auto;overflow-y:hidden/);
  assert.match(css, /\.bottomNav\{[^}]*touch-action:pan-x/);
  assert.match(css, /\.bottomNav\{[^}]*scroll-snap-type:x proximity/);
  assert.match(css, /\.bottomNav button\{[^}]*min-width:48px;min-height:52px/);
  assert.match(css, /@media\(max-width:380px\)[\s\S]*?\.bottomNav button\{min-width:48px;min-height:50px/);
});

test('active destination scrolls into view and tab gestures do not trigger page swipes', () => {
  assert.match(app, /querySelector<HTMLButtonElement>\('button\.active'\)/);
  assert.match(app, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest', behavior: 'auto' \}\)/);
  assert.match(app, /\.noSwipe,\.bottomNav/);
  assert.match(app, /<nav ref=\{navRef\} className='bottomNav' aria-label='Navegación principal'>/);
});

test('all seven primary PWA destinations retain accessible named actions', () => {
  for (const label of ['Inicio', 'Chat', 'Nueva misión', 'Proyectos', 'Meditación IA', 'Capacidades', 'Configuración']) {
    assert.ok(app.includes(`aria-label='${label}'`), `missing navigation destination: ${label}`);
  }
});
