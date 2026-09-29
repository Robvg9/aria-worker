import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'meditation-e2e-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
function envBool(name, fallback = false) { const value = process.env[name]; return value == null ? fallback : /^(1|true|yes)$/i.test(String(value)); }

async function waitFor(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function readPersistedSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const s = raw ? JSON.parse(raw) : null;
      return s && typeof s.accessToken === 'string' ? { userId: String(s.userId || ''), accessToken: s.accessToken } : null;
    } catch { return null; }
  }).catch(() => null);
}

async function loginIfNeeded(page) {
  const password = page.locator('input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
  if (!(await password.count()) || !(await password.isVisible().catch(() => false))) return { attempted:false, status:'already_authenticated' };

  const email = page.locator('input[type="email"],input[name="email"],input[autocomplete="username"]').first();
  if (!(await email.count())) throw new Error('meditation_login_email_input_missing');

  const configuredEmail = process.env.RWHT_EMAIL;
  const configuredPassword = process.env.RWHT_PASSWORD;
  if (!configuredEmail || !configuredPassword) throw new Error('meditation_auth_secrets_missing');

  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    await email.fill(configuredEmail);
    await password.fill(configuredPassword);
    const submit = page.locator('button[type="submit"],input[type="submit"],button')
      .filter({ hasText:/entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
    if (await submit.count()) await submit.click(); else await password.press('Enter');

    const deadline = Date.now() + 70000;
    let session = null;
    while (Date.now() < deadline) {
      session = await readPersistedSession(page);
      if (session?.accessToken) {
        attempts.push({ attempt, status:'authenticated', persisted_session:true });
        return { attempted:true, status:'authenticated', attempts };
      }
      const visibleError = await page.locator('text=/servicio de autenticación|ninguna de sus rutas|tardando demasiado|no pudo alcanzar/i').first().textContent().catch(() => '');
      if (visibleError && await password.isVisible().catch(() => false)) {
        attempts.push({ attempt, status:'auth_error_visible', error:String(visibleError).slice(0,300) });
        break;
      }
      await waitFor(1000);
    }

    attempts.push({ attempt, status:'timeout_waiting_for_session' });
    if (attempt < 3) {
      await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(() => {});
      await waitFor(2000 * attempt);
    }
  }
  throw new Error('meditation_login_failed_after_3_attempts:' + JSON.stringify(attempts).slice(0,1200));
}

async function expectApi(page, apiPath, token) {
  return page.evaluate(async ({ apiPath, token }) => {
    const r = await fetch('/api' + apiPath, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  }, { apiPath, token });
}

async function run() {
  const base = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
  const requireAuth = envBool('RWHT_REQUIRE_AUTH', true);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: envBool('RWHT_HEADLESS', true) });
  const context = await browser.newContext({ viewport: { width: Number(process.env.RWHT_VIEWPORT_WIDTH || 1440), height: Number(process.env.RWHT_VIEWPORT_HEIGHT || 900) } });
  const page = await context.newPage();
  const consoleErrors = []; const pageErrors = []; const failedResponses = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));
  page.on('response', response => { if (response.status() >= 500) failedResponses.push({ status: response.status(), url: response.url() }); });
  const report = { status:'partial_or_failed', auth_verified:false, reload_auth_verified:false, meditation_surface_verified:false, api_health_verified:false, idea_analyzer_verified:false, governed_proposal_verified:false, mission_conversion_verified:false, mission_persistence_verified:false, notifications_route_verified:false, cleaned_up:false, mission_id:null, proposal_id:null, page_errors:0, console_errors:0, failed_responses:0, failure:null };
  try {
    await page.goto(base + '#home', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(1500);
    if (requireAuth) { await loginIfNeeded(page); assert.equal(await page.locator('input[type="password"]').isVisible().catch(() => false), false); }
    report.auth_verified = true;
    await page.goto(base + '#meditation', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('input[type="password"]').count(), 0, 'meditation route must remain authenticated');
    await page.getByText('ANALIZADOR DE IDEAS', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.getByText('ESTADO CLOUD', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.getByText('EJECUCIÓN EN TIEMPO REAL', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.getByRole('button', { name:'ANALIZAR Y PROPONER' }).waitFor({ state:'visible', timeout:30000 });
    report.meditation_surface_verified = true;
    const sessionRaw = await page.evaluate(() => localStorage.getItem('aria_session_v2'));
    assert.ok(sessionRaw, 'aria session missing after login');
    const session = JSON.parse(sessionRaw); assert.ok(session.accessToken, 'access token missing from persisted session');
    const [overview, health, ideas, notifications] = await Promise.all([
      expectApi(page, '/meditation/overview', session.accessToken),
      expectApi(page, '/diagnostics/health', session.accessToken),
      expectApi(page, '/meditation/ideas', session.accessToken),
      expectApi(page, '/meditation/notifications?limit=20', session.accessToken)
    ]);
    for (const [name, result] of [['overview',overview],['health',health],['ideas',ideas],['notifications',notifications]]) assert.equal(result.status,200,name+'_http_'+result.status);
    assert.ok(Array.isArray(ideas.body?.items)); assert.ok(Array.isArray(notifications.body?.items));
    report.api_health_verified = true; report.notifications_route_verified = true;
    const marker = 'RWHTMEDIATION' + Date.now();
    const idea = 'Certificación Meditation IA ' + marker + ': mejorar el diagnóstico operativo y preparar una ruta gobernada sin ejecutar cambios externos.';
    const analyzerInput = page.locator('.ideaAnalyzerInput').first();
    await analyzerInput.fill(idea);
    const analysisPromise = page.waitForResponse(r => r.url().includes('/api/meditation/idea-to-mission') && r.request().method()==='POST', { timeout:30000 });
    await page.getByRole('button', { name:'ANALIZAR Y PROPONER' }).click();
    const analysisResponse = await analysisPromise; assert.equal(analysisResponse.status(),200,'idea analyzer POST must return 200');
    const proposalCard = page.locator('.ideaProposalCard').filter({ hasText:marker }).first();
    await proposalCard.waitFor({ state:'visible', timeout:30000 });
    await proposalCard.getByText('NO AUTOENCOLADA', { exact:true }).waitFor({ state:'visible', timeout:10000 });
    await proposalCard.getByText('NO AUTOEJECUTA', { exact:true }).waitFor({ state:'visible', timeout:10000 });
    report.idea_analyzer_verified = true;
    const proposalResult = await expectApi(page, '/meditation/ideas', session.accessToken);
    const proposal = (proposalResult.body?.items || []).find(item => String(item?.input?.idea || '') === idea);
    assert.equal(proposalResult.status,200); assert.ok(proposal?.proposal_id,'proposal was not persisted'); assert.equal(proposal.status,'proposed');
    report.proposal_id = String(proposal.proposal_id); report.governed_proposal_verified = true;
    await proposalCard.getByRole('button', { name:'Aceptar propuesta' }).click();
    await page.waitForTimeout(700);
    const accepted = await expectApi(page, '/meditation/ideas', session.accessToken);
    const acceptedProposal = (accepted.body?.items || []).find(item => String(item?.proposal_id) === report.proposal_id);
    assert.equal(accepted.status,200); assert.equal(acceptedProposal?.status,'accepted');
    const template = acceptedProposal?.missions?.[0]; assert.ok(template?.mission_id,'accepted proposal has no mission template');
    const createButton = page.locator('.ideaProposalCard').filter({ hasText:marker }).first().getByRole('button', { name:'Crear misión' }).first();
    await createButton.waitFor({ state:'visible', timeout:30000 });
    const convertPromise = page.waitForResponse(r => r.url().includes('/api/meditation/ideas/') && r.url().endsWith('/convert') && r.request().method()==='POST', { timeout:30000 });
    await createButton.click(); const convertResponse = await convertPromise; assert.equal(convertResponse.status(),200,'idea conversion POST must return 200');
    const convertedBody = await convertResponse.json().catch(() => null); const convertedMissionId = convertedBody?.mission?.mission_id || convertedBody?.mission_id;
    assert.ok(convertedMissionId,'conversion response has no mission id'); report.mission_id = String(convertedMissionId);
    await page.getByText('MISIÓN CREADA', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    report.mission_conversion_verified = true;
    const missionOverview = await expectApi(page, '/meditation/overview', session.accessToken);
    assert.equal(missionOverview.status,200); assert.ok((missionOverview.body?.missions || []).some(m => String(m?.mission_id) === report.mission_id),'converted mission not persisted in overview');
    report.mission_persistence_verified = true;
    await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }); await page.waitForTimeout(2500);
    assert.equal(await page.locator('input[type="password"]').count(),0,'reload lost authentication');
    await page.getByText('ANALIZADOR DE IDEAS', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    const reloadedProposal = page.locator('.ideaProposalCard').filter({ hasText:marker }).first();
    await reloadedProposal.waitFor({ state:'visible', timeout:30000 }); await reloadedProposal.getByText('MISIÓN CREADA', { exact:true }).waitFor({ state:'visible', timeout:15000 });
    report.reload_auth_verified = true;
    const missionCheck = await page.evaluate(async ({ id, token }) => { const r = await fetch('/api/missions/' + encodeURIComponent(id), { headers:{ Authorization:'Bearer '+token, Accept:'application/json' } }); return { status:r.status, body:await r.json().catch(()=>null) }; }, { id:report.mission_id, token:session.accessToken });
    assert.equal(missionCheck.status,200);
    const cleanup = await page.evaluate(async ({ id, token }) => { const r = await fetch('/api/missions/' + encodeURIComponent(id) + '/cancel', { method:'POST', headers:{ Authorization:'Bearer '+token, Accept:'application/json' } }); return { status:r.status, body:await r.json().catch(()=>null) }; }, { id:report.mission_id, token:session.accessToken });
    assert.equal(cleanup.status,200,'test mission cleanup failed'); assert.equal(cleanup.body?.cancelled,true); report.cleaned_up=true;
    report.status='verified';
  } catch (error) { report.failure=String(error?.message || error); throw error; }
  finally {
    report.page_errors=pageErrors.length; report.console_errors=consoleErrors.length; report.failed_responses=failedResponses.length;
    fs.writeFileSync(path.join(artifactDir,'rwht-meditation-pwa-report.json'), JSON.stringify(report,null,2));
    await page.screenshot({ path:path.join(artifactDir,'meditation-pwa-final.png'), fullPage:true }).catch(()=>{}); await browser.close();
  }
  if (report.page_errors || report.console_errors || report.failed_responses) throw new Error('meditation_pwa_browser_errors');
}
run().catch(error => { console.error(JSON.stringify({ status:'partial_or_failed', error:String(error?.message || error) },null,2)); process.exit(2); });
