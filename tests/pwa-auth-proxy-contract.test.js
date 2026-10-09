const fs = require('fs');
const worker = fs.readFileSync('worker.js', 'utf8');
const app = fs.readFileSync('pwa/src/App.tsx', 'utf8');
const html = fs.readFileSync('pwa/index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml', 'utf8');
const authRecoveryWorkflow = fs.readFileSync('.github/workflows/aria-supabase-auth-recovery-restart.yml', 'utf8');
const projectsRwhtWorkflow = fs.readFileSync('.github/workflows/projects-rwht-authenticated.yml', 'utf8');

if (!authRecoveryWorkflow.includes("branches:") || !authRecoveryWorkflow.includes("      - main")) throw new Error('production Supabase restart must not be triggered from feature branches');
if (!authRecoveryWorkflow.includes('saw_transition=true')) throw new Error('Supabase restart gate must observe the real restart transition');
if (!authRecoveryWorkflow.includes('stable_healthy -ge 3')) throw new Error('Supabase restart gate must require stable ACTIVE_HEALTHY reads');
if (!authRecoveryWorkflow.includes('SUPABASE_AUTH_PATHS_RESPONSIVE')) throw new Error('Supabase recovery gate must probe Auth and Worker proxy');
if (!projectsRwhtWorkflow.includes('Wait for Supabase Auth and Worker proxy to respond')) throw new Error('Projects E2E must wait for healthy Auth paths');
if (!projectsRwhtWorkflow.includes('SUPABASE_AUTH_PATHS_UNHEALTHY_AFTER_RECOVERY')) throw new Error('Projects E2E must fail early if Auth is still returning 5xx');

if (!worker.includes('if(url.pathname==="/auth/token")')) throw new Error('missing auth proxy route');
if (!worker.includes('async function proxyPasswordSignIn')) throw new Error('missing auth proxy implementation');
if (!worker.includes('["password","refresh_token"]')) throw new Error('auth proxy must support refresh_token grant');
if (worker.includes('SUPABASE_PUBLISHABLE_KEY')) throw new Error('publishable key must not be embedded in worker');
if (!worker.includes('request.headers.get("apikey")')) throw new Error('worker must accept browser publishable key');
if (!worker.includes('grantType==="refresh_token"?60000:20000')) throw new Error('password auth proxy timeout must be bounded at 20s');
if (!worker.includes('if(url.pathname==="/api"||url.pathname.startsWith("/api/"))')) throw new Error('missing same-origin app api proxy');
if (!worker.includes('async function proxyAppApi')) throw new Error('missing app api proxy implementation');
if (!app.includes("const API = '/api';")) throw new Error('PWA must use same-origin app api');
if (!app.includes('CACHE_PREFIX')) throw new Error('PWA cache layer missing');
if (!app.includes('readCached')) throw new Error('PWA stale-cache read path missing');
if (!app.includes('QuickCatalogModal')) throw new Error('dashboard inventory modal missing');
if (!app.includes('conversation_model_execution_failed')) throw new Error('conversation error mapping missing');
if (!app.includes("fetch('/auth/token?grant_type=password'")) throw new Error('PWA still calls Supabase Auth directly');
if (!app.includes('controller.abort(), 15000')) throw new Error('missing browser auth timeout');
if (!html.includes("href='/manifest.json'")) throw new Error('stable manifest reference missing');
if (!html.includes("register('/pwa/sw-%VITE_BUILD%.js'")) throw new Error('canonical /pwa versioned service worker reference missing');

if (!worker.includes('const PWA_BUILD = "__PWA_BUILD__";')) throw new Error('PWA build placeholder missing');
if (!worker.includes('shellPath="/index-"+PWA_BUILD+".html"')) throw new Error('immutable index mapping missing');
if (!worker.includes('if(shellPath==="/manifest.json"||oldManifest)shellPath="/manifest.json";')) throw new Error('stable manifest mapping missing');
if (!worker.includes('shellPath="/sw-"+PWA_BUILD+".js"')) throw new Error('immutable service worker mapping missing');
if (!worker.includes('const isServiceWorker=shellPath==="/sw-"+PWA_BUILD+".js"')) throw new Error('service worker runtime identity guard missing');
if (!worker.includes('JSON.stringify("aria-pwa-" + PWA_BUILD)')) throw new Error('service worker cache must be normalized to current build');
if (!worker.includes('responseHeaders.set("x-aria-pwa-build",PWA_BUILD)')) throw new Error('service worker build response header missing');

if (!workflow.includes('cp dist/index.html "dist/index-${GITHUB_SHA}.html"')) throw new Error('immutable index build missing');
if (!workflow.includes('cp dist/manifest.json "dist/manifest-${GITHUB_SHA}.json"')) throw new Error('immutable manifest build missing');
if (!workflow.includes('sed "s/__BUILD__/${GITHUB_SHA}/g" public/sw.js > "dist/sw-${GITHUB_SHA}.js"')) throw new Error('immutable service worker build missing');
if (!workflow.includes('grep -q "aria-pwa-${GITHUB_SHA}" "dist/sw-${GITHUB_SHA}.js"')) throw new Error('versioned service worker cache verification missing');
if (!workflow.includes('sed -i "s/__PWA_BUILD__/${GITHUB_SHA}/g" worker.js')) throw new Error('worker build injection missing');

console.log('PWA AUTH/NETWORK/IMMUTABLE SHELL CONTRACT: PASS');
if (!worker.includes('PWA_BUILD')) throw new Error('PWA build identity missing in worker');
if (!worker.includes('/version.json')) throw new Error('PWA version endpoint missing');
if (!worker.includes('...(isShell?{cache:"no-store"}:{})')) throw new Error('PWA shell cache boundary missing');
if (worker.includes('cache:isShell?"no-store":"default"')) throw new Error('PWA assets must not use unsupported cache mode default');
if (!app.includes("fetch('/pwa/version.json?ts='")) throw new Error('PWA stale-build self check missing');
if (!fs.readFileSync('pwa/public/sw.js', 'utf8').includes("if (!url.pathname.startsWith('/pwa/')) return;")) throw new Error('service worker scope guard missing');
console.log('PWA UPDATE RESILIENCE CONTRACT: PASS');

if (!app.includes('async function signInDirect')) throw new Error('direct auth path missing');
if (!app.includes('async function signInProxy')) throw new Error('proxy auth fallback missing');
if (!app.includes('async function refreshSessionDirect')) throw new Error('direct session refresh path missing');
if (!app.includes('async function refreshSessionProxy')) throw new Error('proxy session refresh path missing');
if (!app.includes("fetch('/auth/token?grant_type=refresh_token'")) throw new Error('PWA refresh path missing');
if (!app.includes('session.expiresAt - Date.now() - 60_000')) throw new Error('session refresh scheduler missing');

if (!app.includes('15000')) throw new Error('direct auth timeout missing');
if (!app.includes('20000')) throw new Error('proxy auth timeout must be bounded at 20s');
