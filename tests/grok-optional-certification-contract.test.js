const fs = require('node:fs');
const text = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml','utf8');
if (!text.includes('GROK_CONSENT_OPTIONAL_STATUS=$status')) throw new Error('missing optional Grok status');
if (!text.includes('GROK_CONSENT_EXTERNAL_BLOCKED')) throw new Error('missing external blocked classification');
if (!text.includes('external blockage does not block the ARIA core deployment')) throw new Error('missing non-blocking policy');
if (!text.includes('--max-time 12')) throw new Error('Grok request is not bounded');
console.log('grok-optional-certification-contract.test.js: PASS');