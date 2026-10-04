export type TestCatalogItem = {
  id: string;
  file: string;
  title: string;
  category: string;
  includedInNpmTest: boolean;
  how: string;
  capabilities: string;
};

export const TEST_CATALOG_VERSION = '2026-10-02-canonical';
export const TEST_CATALOG: TestCatalogItem[] = [
  {
    id: 'omniroute-absorb-contract',
    file: 'tests/omniroute-absorb-contract.test.js',
    title: 'OmniRoute ABSORB Contract',
    category: 'IA / modelos / routing',
    includedInNpmTest: true,
    how: 'Comprueba el source lock, el aislamiento de Windows y que las fases no certificadas permanezcan bloqueadas.',
    capabilities: 'Valida orden de certificación, autoridad de ARIA y activación fail-closed.'
  },
  {
    "id": "phase6-anti-regression",
    "file": "tests/phase6-anti-regression.test.js",
    "title": "Phase 6 Anti-Regresión Final",
    "category": "Diagnóstico / resiliencia",
    "includedInNpmTest": true,
    "how": "Provoca y verifica fallos operacionales controlados, además de comprobar las defensas de recuperación y no-regresión.",
    "capabilities": "Detecta stale device, deploy drift, contract mismatch, duplicate job, lease expirado, timeout, fallo de verificación, estado stale de UI, proveedor/ejecutor no disponible y saturación."
  },
  {
    "id": "autonomous-windows-rwht-controller",
    "file": "tests/autonomous-windows-rwht-controller.test.js",
    "title": "Autonomous Windows RWHT Controller",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba ejecución gobernada, Computer Use de Windows, recuperación y evidencia física."
  },
  {
    "id": "chat-mission-confirmation-contract",
    "file": "tests/chat-mission-confirmation-contract.test.js",
    "title": "Chat Mission Confirmation Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que la interfaz y sus contratos mantengan el flujo de confirmación de misiones.",
    "capabilities": "Detecta regresiones en chat, confirmación, navegación y creación de misiones."
  },
  {
    "id": "computer-use-live-progress-v1",
    "file": "tests/computer-use-live-progress-v1.test.js",
    "title": "Computer Use Live Progress V1",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba progreso y estado observable durante Computer Use en vivo.",
    "capabilities": "Detecta regresiones de ejecución, progreso, evidencia y sincronización."
  },
  {
    "id": "mastery-learning-loop-v1",
    "file": "tests/mastery-learning-loop-v1.test.js",
    "title": "Mastery Learning Loop V1",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el ciclo de aprendizaje y mejora de ARIA.",
    "capabilities": "Valida aprendizaje, memoria de resultados, evaluación y evolución controlada."
  },
  {
    "id": "mastery-learning-runtime-contract",
    "file": "tests/mastery-learning-runtime-contract.test.js",
    "title": "Mastery Learning Runtime Contract",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que el contrato del runtime de aprendizaje permanezca estable.",
    "capabilities": "Detecta regresiones en aprendizaje, runtime, persistencia y gobernanza."
  },
  {
    "id": "meditation-idea-analyzer-v2",
    "file": "tests/meditation-idea-analyzer-v2.test.js",
    "title": "Meditation Idea Analyzer V2",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el análisis de ideas de Meditation IA.",
    "capabilities": "Detecta regresiones en análisis, clasificación, propuesta de misión y continuidad."
  },
  {
    "id": "mission-runner-v22-executor-inference",
    "file": "tests/mission-runner-v22-executor-inference.test.js",
    "title": "Mission Runner V22 Executor Inference",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que el runner identifique correctamente el ejecutor de cada paso.",
    "capabilities": "Detecta regresiones en inferencia de ejecutor, dispatch y ejecución universal."
  },
  {
    "id": "mission-runner-ssot-regression",
    "file": "tests/mission-runner-ssot-regression.test.js",
    "title": "Mission Runner SSoT Regression",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que el estado canónico de misión, los leases vivos y el recovery async no creen estados activos o reintentos duplicados.",
    "capabilities": "Detecta regresiones de Single Source of Truth, estados contradictorios y reencolado de jobs async."
  },
  {
    "id": "delivery-deterministic-v1",
    "file": "tests/delivery-deterministic-v1.test.js",
    "title": "Delivery Deterministic V1",
    "category": "PWA / UX / API",
    "includedInNpmTest": false,
    "how": "Comprueba la identidad determinista del artefacto, la clasificación release-bearing y la verificación de build contra LIVE.",