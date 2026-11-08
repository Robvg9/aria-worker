import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const catalogPath = join(here, "../src/parity/aria-one-100-parity.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const REQUIRED_IDS = [
  "home.dashboard",
  "chat.conversation",
  "chat.attachments",
  "voice.browser",
  "mission.intake",
  "mission.detail",
  "mission.states",
  "mission.human-gate",
  "meditation.overview",
  "meditation.ideas",
  "projects.previews",
  "projects.chat",
  "projects.canvas",
  "capabilities.catalog",
  "capabilities.tests",
  "capabilities.absorb",
  "settings.preferences",
  "settings.notifications",
  "settings.update-cache",
  "vault.private",
  "telegram.recipient",
  "auth.session"
];

test("catalog identity and digest are stable", () => {
  assert.equal(catalog.mission, "ARIA-ONE-100");
  assert.equal(catalog.phase, "F4");
  assert.equal(catalog.primary_experience, "pwa", "the PWA must remain the primary functional experience");
  assert.match(catalog.catalog_version, /^\d{4}-\d{2}-\d{2}-f4-v\d+$/);
  const ids = catalog.entries.map((entry) => entry.id);
  assert.deepEqual(ids, REQUIRED_IDS, "the catalog must cover every canonical capability exactly once");
  const digest = createHash("sha256").update(ids.join("\n")).digest("hex");
  assert.equal(digest, catalog.catalog_digest, "catalog digest changed; mirror and update the Android matrix deliberately");
});

test("catalog never claims a reduced native-only surface as parity", () => {
  const serialized = JSON.stringify(catalog).toLowerCase();
  assert(!serialized.includes("native-only"));
  assert(!serialized.includes("android-only"));
  assert(!serialized.includes("reduced-surface"));
  assert(!serialized.includes("access_token"));
  assert(!serialized.includes("refresh_token"));
  assert(!serialized.includes("bearer "));
  for (const entry of catalog.entries) {
    assert.equal(typeof entry.capability, "string");
    assert(entry.capability.length >= 12, "each capability needs a concrete description: " + entry.id);
    assert.equal(typeof entry.route, "string");
    assert(catalog.routes.includes(entry.route), "route must be one of the seven canonical destinations: " + entry.id);
  }
});

test("every canonical destination has a bottom-navigation entry", () => {
  const app = readFileSync(join(repoRoot, "pwa/src/App.tsx"), "utf8");
  assert.equal(catalog.routes.length, 7, "ARIA ONE 100 defines exactly seven primary destinations");
  for (const label of catalog.routes) {
    assert(app.includes(`aria-label='${label}'`), "missing navigation destination: " + label);
  }
  assert(app.includes("className='bottomNav'"), "the canonical global bottom navigation must exist");
});

test("every capability anchor still exists in the canonical source", () => {
  for (const entry of catalog.entries) {
    assert(Array.isArray(entry.anchors) && entry.anchors.length > 0, "missing anchors: " + entry.id);
    for (const [file, anchor] of entry.anchors) {
      const absolute = join(repoRoot, file);
      assert(existsSync(absolute), "anchor file missing for " + entry.id + ": " + file);
      const source = readFileSync(absolute, "utf8");
      assert(source.includes(anchor), `anchor drift for ${entry.id}: ${file} does not contain ${anchor}`);
    }
  }
});

test("every capability declares executable evidence that exists", () => {
  for (const entry of catalog.entries) {
    assert(Array.isArray(entry.tests) && entry.tests.length > 0, "missing test evidence: " + entry.id);
    for (const testPath of entry.tests) {
      assert(existsSync(join(repoRoot, testPath)), "evidence file missing for " + entry.id + ": " + testPath);
    }
  }
});

test("critical surfaces are explicitly covered", () => {
  const ids = new Set(catalog.entries.map((entry) => entry.id));
  for (const id of REQUIRED_IDS) assert(ids.has(id), "missing required capability: " + id);
  // A single id may not collapse multiple user-facing capabilities into one row.
  assert.equal(ids.size, catalog.entries.length, "duplicate capability id");
});
