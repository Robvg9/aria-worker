const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const project=fs.readFileSync(path.join(__dirname,'..','pwa/src/ProjectWorkspace.tsx'),'utf8');

assert.doesNotMatch(project,/ARIA \/ PROYECTOS/);
assert.doesNotMatch(project,/Chats aislados por proyecto/);
assert.doesNotMatch(project/=>/);
assert.match(project,/tab!=='chat'/);
assert.match(project,/projectShell/);
assert.match(project,/CHAT EXCLUSIVO/);
assert.match(project,/Procesamiento en curso/);
assert.match(project,/Procesado en/);
console.log('PROJECT CHAT COMPACT + PROCESSING UX CONTRACT: PASS');
