const fs = require('fs');
const worker = fs.readFileSync('worker.js', 'utf8');
const app = fs.readFileSync('pwa/src/App.tsx', 'utf8');
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
console.log('PWA AUTH PROXY CONTRACT: PASS');

const html = fs.readFileSync('pwa/index.html','utf8');
const workflow = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml','utf8');
if (!html.includes("./sw-%VITE_BUILD%.js")) throw new Error('PWA must register build-versioned service worker');
if (!workflow.includes('cp public/sw.js "public/sw-${GITHUB_SHA}.js"')) throw new Error('deploy must generate versioned service worker');
if (!workflow.includes('rm public/sw.js')) throw new Error('deploy must remove unversioned service worker artifact');
if (!workflow.includes('sw-${GITHUB_SHA}.js')) throw new Error('LIVE smoke must validate versioned service worker');
console.log('PWA VERSIONED SERVICE WORKER CONTRACT: PASS');


const workerShell2 = fs.readFileSync('worker.js','utf8');
const pwaIndex2 = fs.readFileSync('pwa/index.html','utf8');
const deploy2 = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml','utf8');
if (!workerShell2.includes('const PWA_BUILD = "__PWA_BUILD__";')) throw new Error('PWA build placeholder missing');
if (!workerShell2.includes('shellPath="/index-"+PWA_BUILD+".html"')) throw new Error('immutable index mapping missing');
if (!pwaIndex2.includes("manifest-%VITE_BUILD%.json")) throw new Error('immutable manifest reference missing');
if (!deploy2.includes('cp dist/index.html "dist/index-${GITHUB_SHA}.html"')) throw new Error('immutable index build missing');
if (!deploy2.includes('sed -i "s/__PWA_BUILD__/${GITHUB_SHA}/g" worker.js')) throw new Error('worker build injection missing');
console.log('PWA IMMUTABLE SHELL CONTRACT: PASS');
