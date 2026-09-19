const fs = require('fs');
const worker = fs.readFileSync('worker.js', 'utf8');
const app = fs.readFileSync('pwa/src/App.tsx', 'utf8');
const html = fs.readFileSync('pwa/index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml', 'utf8');

if (!worker.includes('if(url.pathname==="/auth/token")')) throw new Error('missing auth proxy route');
if (!worker.includes('async function proxyPasswordSignIn')) throw new Error('missing auth proxy implementation');
if (worker.includes('SUPABASE_PUBLISHABLE_KEY')) throw new Error('publishable key must not be embedded in worker');
if (!worker.includes('request.headers.get("apikey")')) throw new Error('worker must accept browser publishable key');
if (!worker.includes('controller.abort(),12000')) throw new Error('missing upstream auth timeout');
if (!worker.includes('if(url.pathname==="/api"||url.pathname.startsWith("/api/"))')) throw new Error('missing same-origin app api proxy');
if (!worker.includes('async function proxyAppApi')) throw new Error('missing app api proxy implementation');
if (!app.includes("const API = '/api';")) throw new Error('PWA must use same-origin app api');
if (!app.includes('CACHE_PREFIX')) throw new Error('PWA cache layer missing');
if (!app.includes('readCached')) throw new Error('PWA stale-cache read path missing');
if (!app.includes('QuickCatalogModal')) throw new Error('dashboard inventory modal missing');
if (!app.includes('conversation_model_execution_failed')) throw new Error('conversation error mapping missing');
if (!app.includes("fetch('/auth/token?grant_type=password'")) throw new Error('PWA still calls Supabase Auth directly');
if (!app.includes('controller.abort(), 15000')) throw new Error('missing browser auth timeout');
if (!html.includes("manifest-%VITE_BUILD%.json")) throw new Error('immutable manifest reference missing');
if (!html.includes("sw-%VITE_BUILD%.js")) throw new Error('build-versioned service worker reference missing');

if (!worker.includes('const PWA_BUILD = "__PWA_BUILD__";')) throw new Error('PWA build placeholder missing');
if (!worker.includes('shellPath="/index-"+PWA_BUILD+".html"')) throw new Error('immutable index mapping missing');
if (!worker.includes('shellPath="/manifest-"+PWA_BUILD+".json"')) throw new Error('immutable manifest mapping missing');
if (!worker.includes('shellPath="/sw-"+PWA_BUILD+".js"')) throw new Error('immutable service worker mapping missing');

if (!workflow.includes('cp dist/index.html "dist/index-${GITHUB_SHA}.html"')) throw new Error('immutable index build missing');
if (!workflow.includes('cp dist/manifest.json "dist/manifest-${GITHUB_SHA}.json"')) throw new Error('immutable manifest build missing');
if (!workflow.includes('cp public/sw.js "dist/sw-${GITHUB_SHA}.js"')) throw new Error('immutable service worker build missing');
if (!workflow.includes('sed -i "s/__PWA_BUILD__/${GITHUB_SHA}/g" worker.js')) throw new Error('worker build injection missing');
if (!workflow.includes('versioned_html=')) throw new Error('versioned HTML smoke missing');

console.log('PWA AUTH/NETWORK/IMMUTABLE SHELL CONTRACT: PASS');
if (!worker.includes('PWA_BUILD')) throw new Error('PWA build identity missing in worker');
if (!worker.includes('/version.json')) throw new Error('PWA version endpoint missing');
if (!worker.includes('cache:isShell?"no-store":"default"')) throw new Error('PWA shell cache boundary missing');
if (!app.includes("fetch('/pwa/version.json?ts='")) throw new Error('PWA stale-build self check missing');
if (!fs.readFileSync('pwa/public/sw.js', 'utf8').includes("if (!url.pathname.startsWith('/pwa/')) return;")) throw new Error('service worker scope guard missing');
console.log('PWA UPDATE RESILIENCE CONTRACT: PASS');
