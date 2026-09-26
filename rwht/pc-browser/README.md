# PC Browser RWHT

Reusable desktop-browser Real World Human Test infrastructure for ARIA, BattleCruiser, CuevaCoin, and future web apps.

## What it verifies

The runner uses a real Chromium instance on a desktop viewport and, route by route:

- opens the target page;
- optionally logs in with `RWHT_EMAIL` / `RWHT_PASSWORD`;
- discovers buttons, links, tabs, menu items, inputs, textareas, selects, and contenteditable controls;
- reopens the route before each control so one broken click does not poison the rest of the audit;
- verifies safe controls one by one;
- blocks destructive/logout/secret interactions by default;
- checks horizontal overflow and basic interaction/accessibility hygiene;
- captures JavaScript errors and HTTP 5xx responses;
- produces JSON evidence plus screenshots.

The runner is intentionally app-agnostic. Set `RWHT_URL` and, when needed, `RWHT_ROUTES` for another application.

## Local Windows/PC execution

From `rwht/pc-browser`:

```powershell
npm install
npx playwright install chromium
$env:RWHT_URL="https://example.com"
node .\rwht-pc-browser.mjs
```

For authenticated apps:

```powershell
$env:RWHT_EMAIL="..."
$env:RWHT_PASSWORD="..."
node .\rwht-pc-browser.mjs
```

ARIA's current default PWA entrypoint is `https://aria.robvg9.workers.dev/pwa/`.

ARIA's current default route set is:

`#home,#chat,#projects,#meditation,#capabilities,#settings,#mission`

For another web app:

```powershell
$env:RWHT_ROUTES="#home,/settings,/admin"
```

## Safety model

RWHT is a verification runner, not a destructive migration tool. Controls matching the blocked-risk vocabulary are not clicked. Passwords, tokens, API keys, file uploads, and similar secret-like fields are not populated.

That gives exhaustive coverage of the discoverable and safe browser UI while keeping destructive/secret actions behind an explicit Human Gate.


## Authenticated PC RWHT

For a full authenticated audit without storing a password in the runner, provide a Playwright storage-state JSON file obtained from a controlled browser session:

```powershell
$env:RWHT_STORAGE_STATE="C:\RWHT\aria-auth.json"
$env:RWHT_REQUIRE_AUTH="true"
$env:RWHT_EXPECTED_AUTH_TEXT="Lista para actuar"
node .\rwht-pc-browser.mjs
```

The runner will reuse that session state, audit the authenticated surface, and keep destructive/secret actions behind the normal Human Gate.\n