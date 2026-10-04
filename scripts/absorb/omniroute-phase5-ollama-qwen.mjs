'use strict';

const baseUrl = String(process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20130').replace(/\/$/, '');
const apiKey = process.env.OMNIROUTE_API_KEY || '';
const model = process.env.OMNIROUTE_SMOKE_MODEL || 'ollama/qwen3:4b';
const marker = 'OMNIROUTE_QWEN_LIVE_OK';
const timeoutMs = Number(process.env.OMNIROUTE_SMOKE_TIMEOUT_MS || 180000);

if (!apiKey) { console.error('NOT_CERTIFIED: OMNIROUTE_API_KEY missing'); process.exit(2); }

(async () => {
  const response = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
      'x-omniroute-provider': 'ollama'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Return exactly OMNIROUTE_QWEN_LIVE_OK' }],
      temperature: 0,
      stream: false
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const raw = await response.text();
  let json = null; try { json = JSON.parse(raw); } catch {}
  const content = String(json?.choices?.[0]?.message?.content || '').trim();
  const routedBy = String(response.headers.get('x-omniroute-routed-by') || '').trim();
  const decision = String(response.headers.get('x-omniroute-route-decision') || '').trim();
  const provider = /^ollama\\b/i.test(decision) ? 'ollama' : '';
  const pass = response.status === 200 && content.includes(marker) && routedBy === 'self-hosted-openai-compat' && provider === 'ollama' && /\bollama\b/i.test(decision);
  const receipt = {
    schema: 'aria.absorb.omniroute.phase5.capture.v1',
    status: pass ? 'PASS_REAL_OLLAMA_QWEN' : 'NOT_CERTIFIED',
    base_url: baseUrl, model, provider, decision, http_status: response.status,
    response_content_present: Boolean(content), marker_present: content.includes(marker),
    aria_runtime_touched: false, captured_at_utc: new Date().toISOString()
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (!pass) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });