'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'agents/windows/aria-meditation-ui.ps1'),'utf8');
const controller=fs.readFileSync(path.join(root,'agents/windows/aria-meditation-controller.js'),'utf8');
for(const route of ['/idea-to-mission','/ideas']){assert.ok(controller.includes(route),'controller route missing: '+route);assert.ok(ui.includes(route),'UI route missing: '+route);}
for(const marker of ['IDEA -> MISION','ANALIZAR Y PROPONER','ACTUALIZAR PROPUESTAS','NO AUTOENCOLADA','autoencolado','ConvertTo-Json -Depth 16']) assert.ok(ui.includes(marker),'UI marker missing: '+marker);
console.log('MEDITATION IDEA -> MISSION UI CONTRACT: PASS');
