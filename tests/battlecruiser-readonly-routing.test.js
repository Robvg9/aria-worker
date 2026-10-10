const assert = require("node:assert/strict");
const test = require("node:test");
const intentPromise = import("../supabase/functions/_shared/battlecruiser-github-write-intent.mjs");

test("read-only BC context mission never routes to branch/file writes", async () => {
  const { hasExplicitBattleCruiserGitHubWriteIntent } = await intentPromise;
  const goal = "Inspeccion no mutante del contexto de integracion BattleCruiser. Usa solo el campo battlecruiser_live_context recibido en los metadatos. No uses shell, SQL, navegador, Git ni herramientas de escritura. No cambies codigo, archivos, ramas, PRs ni datos empresariales.";
  assert.equal(hasExplicitBattleCruiserGitHubWriteIntent(goal), false);
});

test("mere mention of a branch, file, PR, or GitHub is not write authorization", async () => {
  const { hasExplicitBattleCruiserGitHubWriteIntent } = await intentPromise;
  const goal = "Inspecciona BattleCruiser: revisa el estado de la rama, archivo y PR existentes. No modifiques archivos, ramas ni PRs.";
  assert.equal(hasExplicitBattleCruiserGitHubWriteIntent(goal), false);
});

test("explicit controlled probe still routes when writes are positively requested", async () => {
  const { hasExplicitBattleCruiserGitHubWriteIntent } = await intentPromise;
  const goal = "En BattleCruiser, realiza una prueba controlada de conexión ARIA ↔ BattleCruiser: crea una rama aria/sandbox/rwht-battlecruiser-20260924, añade un archivo temporal RWHT_ARIA_PROBE.md indicando que esta es una prueba de integración, verifica que el archivo exista en la rama y abre un PR hacia main. No hagas merge.";
  assert.equal(hasExplicitBattleCruiserGitHubWriteIntent(goal), true);
});

test("read-only phrases override write-like nouns", async () => {
  const { hasExplicitBattleCruiserGitHubWriteIntent } = await intentPromise;
  const goal = "BattleCruiser read-only audit. Review branch, file, and pull request. No changes.";
  assert.equal(hasExplicitBattleCruiserGitHubWriteIntent(goal), false);
});
