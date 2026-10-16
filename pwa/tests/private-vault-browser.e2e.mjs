import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const ORIGIN = "http://localhost:5173";
const PAGE_URL = ORIGIN + "/pwa/#settings";
const API_BASE = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-app-api-v3/private-vault";
const PASSWORD = "synthetic-browser-passphrase-2026";
const NOTE_TITLE = "synthetic encrypted title";
const NOTE_CONTENT = "synthetic private test payload that must never leave the browser as plaintext";
const pwaDir = new URL("../", import.meta.url);
const viteEntry = new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname;
let server;
let browser;

async function waitForServer() {
  let lastError;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(ORIGIN + "/pwa/");
      if (response.ok) return;
      lastError = new Error("Vite preview returned HTTP " + response.status);
    } catch (error) { lastError = error; }
    await delay(250);
  }
  throw lastError ?? new Error("Vite preview did not start.");
}

function jsonResponse(origin, body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-max-age": "600",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  };
}

server = spawn(process.execPath, [
  viteEntry, "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort",
], { cwd: pwaDir, stdio: "ignore", env: { ...process.env, VITE_BUILD: "browser-e2e-synthetic" } });

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem("aria_session_v2", JSON.stringify({
      accessToken: "synthetic-e2e-token-not-valid-for-live",
      refreshToken: "synthetic-e2e-refresh-not-valid-for-live",
      userId: "e2e-synthetic-owner",
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: "synthetic-owner@example.invalid",
    }));
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error?.message ?? error)));

  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith("/system")) body = { aria: { status: "ready" } };
    else if (url.pathname.includes("/missions")) body = { missions: [] };
    else if (url.pathname.endsWith("/capabilities")) body = {
      capabilities: { summary: {}, models: [], agents: [], devices: [], executors: [], connections: [], generated_at: new Date().toISOString() },
    };
    else if (url.pathname.endsWith("/diagnostics/health")) body = { health: { status: "healthy" } };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: { "cache-control": "no-store" } });
  });

  let savedConfig = null;
  let savedVaultId = "";
  const storedRecords = new Map();
  const configPutBodies = [];
  const recordPutBodies = [];
  const allBodyText = [];
  const noPlaintextFields = () => ({});

  await page.route(API_BASE + "**", async route => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = new URL(req.url());
    const marker = "/private-vault";
    const index = url.pathname.indexOf(marker);
    const path = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
    const cors = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "cache-control": "no-store, private",
    };
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const bodyText = req.postData() ?? "";
    if (bodyText) allBodyText.push(bodyText);
    if (method === "GET" && path === "/vaults") {
      await route.fulfill({ ...jsonResponse(ORIGIN, { vaults: savedConfig ? [{ ...savedConfig, vault_id: savedVaultId }] : [] }), headers: cors });
      return;
    }
    const configMatch = path.match(/^\/vaults\/([0-9a-f-]+)$/i);
    if (configMatch && method === "PUT") {
      const input = req.postDataJSON();
      configPutBodies.push(input);
      savedVaultId = configMatch[1];
      savedConfig = { ...input, vault_id: savedVaultId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await route.fulfill({ ...jsonResponse(ORIGIN, { saved: true, vault_id: savedVaultId, format_version: 1 }), headers: cors });
      return;
    }
    if (configMatch && method === "GET") {
      if (!savedConfig || savedVaultId !== configMatch[1]) {
        await route.fulfill({ ...jsonResponse(ORIGIN, { error: "vault_not_found" }, 404), headers: cors });
      } else {
        await route.fulfill({ ...jsonResponse(ORIGIN, { vault: savedConfig }), headers: cors });
      }
      return;
    }
    const listMatch = path.match(/^\/vaults\/([0-9a-f-]+)\/records$/i);
    if (listMatch && method === "GET") {
      const records = [...storedRecords.entries()].map(([recordId, value]) => ({
        record_id: recordId, revision: value.revision, payload_nonce: value.payload_nonce, created_at: value.created_at,
      }));
      await route.fulfill({ ...jsonResponse(ORIGIN, { records, limit: 100, offset: 0, next_offset: null }), headers: cors });
      return;
    }
    const recordMatch = path.match(/^\/vaults\/([0-9a-f-]+)\/records\/([0-9a-f-]+)$/i);
    if (recordMatch && method === "PUT") {
      const input = req.postDataJSON();
      recordPutBodies.push(input);
      const forbidden = ["title", "content", "plaintext", "password", "recovery_key", "vault_key"];
      for (const field of forbidden) assert.equal(Object.hasOwn(input, field), false, "plaintext/secret field leaked in record API payload: " + field);
      const recordId = recordMatch[2];
      storedRecords.set(recordId, { ...input, created_at: new Date().toISOString() });
      await route.fulfill({ ...jsonResponse(ORIGIN, { saved: true, record_id: recordId, revision: input.revision }, 201), headers: cors });
      return;
    }
    if (recordMatch && method === "GET") {
      const stored = storedRecords.get(recordMatch[2]);
      if (!stored) {
        await route.fulfill({ ...jsonResponse(ORIGIN, { error: "record_not_found" }, 404), headers: cors });
      } else {
        await route.fulfill({ ...jsonResponse(ORIGIN, { record: stored }), headers: cors });
      }
      return;
    }
    await route.fulfill({ ...jsonResponse(ORIGIN, { error: "route_not_found" }, 404), headers: cors });
  });

  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  const panel = page.getByTestId("aria-private-vault");
  await panel.waitFor({ state: "visible" });
  await page.getByText("API accesible", { exact: false }).waitFor({ state: "visible" });

  await panel.getByRole("button", { name: "Crear bóveda", exact: true }).click();
  await panel.getByLabel("Nueva contraseña (mínimo 16 caracteres)").fill(PASSWORD);
  await panel.getByLabel("Repite la contraseña").fill(PASSWORD);
  await panel.getByRole("button", { name: "Generar bóveda y clave de recuperación" }).click();
  const recoveryCode = await panel.locator(".privateVaultRecoveryCode").textContent();
  assert.match(String(recoveryCode), /^[A-Za-z0-9_-]{43}$/u, "recovery key should be a random 256-bit base64url value");
  await panel.getByLabel("Vuelve a escribir la clave completa").fill(String(recoveryCode));
  await panel.getByRole("button", { name: "Confirmar y guardar" }).click();
  await panel.getByText("Bóveda desbloqueada", { exact: false }).waitFor({ state: "visible" });
  assert.equal(configPutBodies.length, 1, "vault configuration should be written once after recovery-key confirmation");
  assert.equal(configPutBodies[0].format_version, 1);
  assert.equal(Object.hasOwn(configPutBodies[0], "password"), false);
  assert.equal(Object.hasOwn(configPutBodies[0], "recovery_key"), false);
  assert.equal(JSON.stringify(configPutBodies[0]).includes(PASSWORD), false);
  assert.equal(JSON.stringify(configPutBodies[0]).includes(String(recoveryCode)), false);

  await panel.getByLabel("Título (solo dentro del ciphertext)").fill(NOTE_TITLE);
  await panel.getByLabel("Contenido (solo dentro del ciphertext)").fill(NOTE_CONTENT);
  await panel.getByRole("button", { name: "Cifrar y guardar nota" }).click();
  await panel.getByText(NOTE_TITLE, { exact: true }).waitFor({ state: "visible" });
  await panel.getByText(NOTE_CONTENT, { exact: true }).waitFor({ state: "visible" });
  assert.equal(recordPutBodies.length, 1, "one ciphertext record write should occur");
  const recordBody = recordPutBodies[0];
  assert.deepEqual(Object.keys(recordBody).sort(), ["ciphertext", "format_version", "payload_nonce", "revision"]);
  assert.equal(JSON.stringify(recordBody).includes(NOTE_TITLE), false);
  assert.equal(JSON.stringify(recordBody).includes(NOTE_CONTENT), false);
  assert.equal(JSON.stringify(recordBody).includes(PASSWORD), false);
  assert.equal(JSON.stringify(recordBody).includes(String(recoveryCode)), false);
  assert.ok(recordBody.ciphertext.length > 30);
  assert.equal(recordBody.format_version, 1);

  const localState = await page.evaluate(() => JSON.stringify(Object.values(localStorage)));
  for (const secret of [PASSWORD, String(recoveryCode), NOTE_TITLE, NOTE_CONTENT]) {
    assert.equal(localState.includes(secret), false, "in-memory private data was persisted to localStorage");
  }

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByText(NOTE_TITLE, { exact: true }).waitFor({ state: "detached" });
  await panel.getByRole("button", { name: "Desbloquear", exact: true }).waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, [], "no uncaught browser errors should occur");
  await context.close();
  console.log("PASS: browser-created vault, recovery confirmation, ciphertext-only record PUT, no localStorage secrets, visibility lock; config PUTs=" + configPutBodies.length + ", record PUTs=" + recordPutBodies.length);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await delay(250);
    if (!server.killed) server.kill("SIGKILL");
  }
}
