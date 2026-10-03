'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const project=fs.readFileSync(path.join(root,'pwa/src/ProjectWorkspace.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');

assert.match(project,/className='visualComposerDock'/);
assert.match(project,/className='modalActions'/);
assert.match(css,/\.visualComposerDock\{display:grid/);
assert.match(css,/position:sticky;/);
assert.match(css,/padding:8px 0 calc\(8px \+ env\(safe-area-inset-bottom\)\)/);
assert.match(css,/\.visualComposerDock \.modalActions/);
assert.match(css,/background:#120e1d/);

console.log('ARTIA MOBILE VIEWPORT CONTRACT: PASS — visual instruction and mission/chat actions stay reachable above the mobile navigation');
