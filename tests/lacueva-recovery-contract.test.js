'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

test('LaCueva recovery script disables Ollama and reuses canonical ARIA task',()=>{
  const p=fs.readFileSync(require.resolve('../agents/windows/lacueva-recovery.ps1'),'utf8');
  assert.match(p,/Disable-ScheduledTask/);
  assert.match(p,/Get-Process -Name ollama/);
  assert.match(p,/ollama_enabled = \$false/);
  assert.match(p,/ARIA-Windows-Local-Agent/);
  assert.doesNotMatch(p,/schtasks\.exe \/Run \/TN.*ARIA-Desktop-Commander-Remote/);
  assert.match(p,/LACUEVA_RECOVERY=PASS/);
});
