const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');
const responsiveRunner=fs.readFileSync(path.join(root,'rwht/pc-browser/rwht-responsive-ux-e2e.mjs'),'utf8');

assert.match(css,/body\{margin:0;min-width:320px;min-height:100vh/);
assert.match(css,/\.pwaShell\{overflow-x:hidden;/);
assert.match(css,/\.screenViewport\{[^}]*overflow:hidden;/);
assert.match(css,/\.appShell\{height:100dvh;min-height:0;max-height:100dvh;overflow:hidden;/);
assert.match(css,/\.pageBodyViewport\{[^}]*overflow:auto;/);
assert.match(css,/\.chatPanel \.chatWindow[^}]*overflow:auto;/);
assert.match(css,/\.projectBodyViewport\{[^}]*overflow:auto;/);
assert.match(css,/\.bottomNav\{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)/);
assert.match(css,/\.bottomNav button\{width:100%;min-width:0;min-height:52px/);
assert.match(css,/\.tabButton\{min-height:40px;box-sizing:border-box;/);
assert.match(css,/\.ideaProposalList\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
assert.match(css,/\.ideaProposalCard\{width:100%;min-width:0;max-width:100%;box-sizing:border-box/);
assert.match(css,/\.ideaMetaGrid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)/);
assert.match(css,/\.primary,.ghost,.tool,.send,.actionCard,.tabButton\{min-height:40px;box-sizing:border-box;/);
assert.match(css,/\.bottomNav button small\{[^}]*text-overflow:ellipsis/);
assert.match(css,/\.desktopOnly\{display:none !important;/);
assert.match(css,/\.modalBackdrop\{position:fixed;inset:0/);
assert.match(css,/\.detailModal\{width:min\(760px,100%\);max-height:88vh;overflow:auto/);
assert.match(css,/\.canvasWrap\{[^}]*overflow:auto/);
assert.match(css,/\.canvasWrap canvas\{[^}]*max-width:100%/);
assert.match(css,/@media\(max-width:900px\)/);
assert.match(css,/@media\(max-width:560px\)/);
assert.match(css,/@media\(max-width:700px\)/);
assert.match(css,/@media\(max-width:380px\)/);
assert.match(css,/\.realityBoardEntry \.panelHeading\{flex-direction:column;align-items:stretch\}/);
assert.match(css,/\.realityBoardEntry \.panelHeading>a\.ghost\{[^}]*white-space:normal!important;/);
assert.match(css,/@media\(max-width:380px\)\{\s*\.projectOverviewPreview \.panelHeading\{flex-direction:column;align-items:stretch\}/, 'live project preview heading must stack on 320px phones');
assert.match(css,/\.projectOverviewPreview \.panelHeading>div:last-child>a\.ghost\{[^}]*white-space:normal!important;overflow-wrap:anywhere\}/, 'project LIVE link must wrap without clipping narrow-screen preview status');

assert.match(responsiveRunner,/externalPreviewRuntimeErrors/);
assert.match(responsiveRunner,/new Set\(\['aria\.robvg9\.workers\.dev', 'icuqsstxfdbvjytkhlog\.supabase\.co'\]\)/);
assert.match(responsiveRunner,/evidence\.external_preview_runtime_errors/);

// Keep the LIVE responsive RWHT contract strict for narrow phones and real scrolling.
assert.match(responsiveRunner, /\{ name: 'mobile-narrow', width: 320, height: 700 \}/,
  'Responsive E2E must exercise the narrow 320px viewport');
assert.match(responsiveRunner, /const target = before < max \? max : 0;/,
  'Real-scroll probe must choose the opposite endpoint if the current scroll is already at bottom');
assert.match(responsiveRunner, /el\.scrollTop = target/,
  'Real-scroll probe must actually assign the target position');
assert.match(responsiveRunner, /changed: after !== before/,
  'Real-scroll probe must report observed movement, not just availability');
assert.match(responsiveRunner, /el\.scrollTop = before/,
  'Real-scroll probe must restore the original scroll position after measurement');
assert.match(responsiveRunner, /if \(result\.available && !result\.changed\)/,
  'Real-scroll probe must fail closed when a scrollable container is found but does not move');

assert.match(app,/function GlobalBottomNav/);
assert.match(app,/aria-label='Navegación principal'/);
assert.match(app,/aria-label='Nueva misión'/);
assert.match(app,/globalSwipeStartRef/);
assert.match(app,/event.pointerType !== 'touch'/);
assert.match(app,/const SWIPE_PAGES = \['#home', '#chat', '#projects', '#meditation', '#capabilities', '#settings'\]/);
assert.match(app,/function handleGlobalPointerDown/);
assert.match(app,/function handleGlobalPointerUp/);
assert.match(app,/role='dialog'/);
assert.match(app,/aria-label='Confirmar inicio de misión'/);

// The fixed notification launcher must not cover mobile CTAs/content.
assert.match(css,/@media\(max-width:700px\)\{[^}]*\.notificationLauncher\{[^}]*top:10px;right:8px;bottom:auto/);
assert.match(css,/@media\(max-width:700px\)\{[^}]*\.notificationLauncher>span:nth-child\(2\)\{display:none\}\}/);
assert.match(app,/aria-label=\{permission === 'granted' \? 'Abrir avisos de ARIA' : 'Activar avisos de ARIA'\}/);

console.log('RESPONSIVE UX CONTRACT: PASS');
