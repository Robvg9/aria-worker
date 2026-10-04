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
    how: 'Comprueba que el caso OmniRoute mantenga bloqueadas las fases no certificadas, conserve la autoridad de ARIA y que los runners de sandbox/standalone permanezcan fail-closed.',
    capabilities: 'Valida source lock, aislamiento Windows, orden de fases, contrato del adaptador futuro y ausencia de activación prematura.'
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
    "capabilities": "Detecta drift entre commit desplegado, artefactos PWA, identidad LIVE y catálogo canónico."
  },
  {
    "id": "explicit-device-intent-planner-contract",
    "file": "tests/explicit-device-intent-planner-contract.test.js",
    "title": "Explicit Device Intent Planner Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que la intención explícita de ejecución en dispositivo llegue del runner al planner y produzca un paso gobernado.",
    "capabilities": "Detecta regresiones en selección de dispositivo, operación shell.execute, verificación y contrato planner-runner."
  },
  {
    "id": "pc-rwht-browser",
    "file": "tests/pc-rwht-browser.test.js",
    "title": "PC RWHT Browser",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba el contrato de auditoría RWHT de la PWA en navegador PC.",
    "capabilities": "Detecta regresiones en navegador, PWA, navegación y certificación RWHT."
  },
  {
    "id": "pwa-capabilities-test-center-v1",
    "file": "tests/pwa-capabilities-test-center-v1.test.js",
    "title": "PWA Capabilities Test Center V1",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba la superficie de capacidades y el centro de pruebas de la PWA.",
    "capabilities": "Detecta regresiones en catálogo, filtros, navegación, contratos y UX de pruebas."
  },
  {
    "id": "pwa-chat-history-race",
    "file": "tests/pwa-chat-history-race.test.js",
    "title": "PWA Chat History Race",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que restaurar el historial tarde no borre mensajes enviados durante la carga inicial.",
    "capabilities": "Detecta carreras entre la restauración GET y los envíos POST, preservando conversación e historial local."
  },
  {
    "id": "pwa-persistence-recovery-v1",
    "file": "tests/pwa-persistence-recovery-v1.test.js",
    "title": "PWA Persistence + Recovery V1",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba persistencia de sesión, caché, conversación y recuperación del PWA ante reload y fallos transitorios del API.",
    "capabilities": "Detecta regresiones de persistencia, renovación de sesión, recuperación tras fallo de red y sincronización posterior."
  },
  {
    "id": "pwa-responsive-ux-v1",
    "file": "tests/pwa-responsive-ux-v1.test.js",
    "title": "PWA Responsive UX V1",
    "category": "PWA / UX / API",
    "includedInNpmTest": false,
    "how": "Comprueba la PWA en múltiples viewports, navegación, scroll, focus, touch, clipping, overflow y modales.",
    "capabilities": "Detecta regresiones responsive, overflow, controles pequeños, navegación móvil, teclado y layout."
  },
  {
    "id": "account-manager",
    "file": "tests/account-manager.test.js",
    "title": "Account Manager",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "activation-governance",
    "file": "tests/activation-governance.test.js",
    "title": "Activation Governance",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "adapter-boundary",
    "file": "tests/adapter-boundary.test.js",
    "title": "Adapter Boundary",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "adaptive-replan",
    "file": "tests/adaptive-replan.test.js",
    "title": "Adaptive Replan",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "advanced-planner-orchestrator",
    "file": "tests/advanced-planner-orchestrator.test.js",
    "title": "Advanced Planner Orchestrator",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "advanced-planner-runtime",
    "file": "tests/advanced-planner-runtime.test.js",
    "title": "Advanced Planner Runtime",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "advanced-planner-v1",
    "file": "tests/advanced-planner-v1.test.js",
    "title": "Advanced Planner V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "af3-integrity",
    "file": "tests/af3-integrity.test.js",
    "title": "AF-3 Integrity",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "af4-orchestrator",
    "file": "tests/af4-orchestrator.test.js",
    "title": "AF-4 Orchestrator",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "af4-runtime-integration",
    "file": "tests/af4-runtime-integration.test.js",
    "title": "AF-4 Runtime Integration",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "agent-policy",
    "file": "tests/agent-policy.test.js",
    "title": "Agent Policy",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "agent-runtime-catalog-contract",
    "file": "tests/agent-runtime-catalog-contract.test.js",
    "title": "Agent Runtime Catalog Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "agent-runtime-v1",
    "file": "tests/agent-runtime-v1.test.js",
    "title": "Agent Runtime V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "all-for-one-council",
    "file": "tests/all-for-one-council.test.js",
    "title": "All For One Council",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "all-for-one-forensic-audit",
    "file": "tests/all-for-one-forensic-audit.test.js",
    "title": "All For One Forensic Audit",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "android-accessibility-v1",
    "file": "tests/android-accessibility-v1.test.js",
    "title": "Android Accessibility V",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-autonomous-evidence-persistence",
    "file": "tests/android-autonomous-evidence-persistence.test.js",
    "title": "Android Autonomous Evidence Persistence",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-autonomous-gateway-contract",
    "file": "tests/android-autonomous-gateway-contract.test.js",
    "title": "Android Autonomous Gateway Contract",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-autonomous-runner-v1",
    "file": "tests/android-autonomous-runner-v1.test.js",
    "title": "Android Autonomous Runner V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-browser-bridge-adapter-v1-targeted",
    "file": "tests/android-browser-bridge-adapter-v1-targeted.test.js",
    "title": "Android Browser Bridge Adapter V Targeted",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-browser-bridge-adapter-v1",
    "file": "tests/android-browser-bridge-adapter-v1.test.js",
    "title": "Android Browser Bridge Adapter V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-browser-bridge-termux-v1",
    "file": "tests/android-browser-bridge-termux-v1.test.js",
    "title": "Android Browser Bridge Termux V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-browser-bridge-v1",
    "file": "tests/android-browser-bridge-v1.test.js",
    "title": "Android Browser Bridge V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-enqueue-gateway-wrapper",
    "file": "tests/android-enqueue-gateway-wrapper.test.js",
    "title": "Android Enqueue Gateway Wrapper",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-google-decision-route",
    "file": "tests/android-google-decision-route.test.js",
    "title": "Android Google Decision Route",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-job-gateway-transport",
    "file": "tests/android-job-gateway-transport.test.js",
    "title": "Android Job Gateway Transport",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "android-ui-agent-autonomous-transport",
    "file": "tests/android-ui-agent-autonomous-transport.test.js",
    "title": "Android UI Agent Autonomous Transport",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "approval-migration",
    "file": "tests/approval-migration.test.js",
    "title": "Approval Migration",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "approval-store",
    "file": "tests/approval-store.test.js",
    "title": "Approval Store",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "approval-supabase-adapter",
    "file": "tests/approval-supabase-adapter.test.js",
    "title": "Approval Supabase Adapter",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "aria-app-api-contract",
    "file": "tests/aria-app-api-contract.test.js",
    "title": "Aria App API Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "aria-app-api-events-schema-regression",
    "file": "tests/aria-app-api-events-schema-regression.test.js",
    "title": "Aria App API Events Schema Regression",
    "category": "PWA / UX / API",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "aria-app-api-v3-contract",
    "file": "tests/aria-app-api-v3-contract.test.js",
    "title": "Aria App API V Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "aria-boot-resilience",
    "file": "tests/aria-boot-resilience.test.js",
    "title": "Aria Boot Resilience",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "aria-eas-mcp-contract",
    "file": "tests/aria-eas-mcp-contract.test.js",
    "title": "Aria Eas Mcp Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "autonomous-runtime",
    "file": "tests/autonomous-runtime.test.js",
    "title": "Autonomous Runtime",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "autonomous-windows-qwen3",
    "file": "tests/autonomous-windows-qwen3.test.js",
    "title": "Autonomous Windows Qwen3",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "autonomy-expansion-v3",
    "file": "tests/autonomy-expansion-v3.test.js",
    "title": "Autonomy Expansion V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "autonomy-self-development-bridge",
    "file": "tests/autonomy-self-development-bridge.test.js",
    "title": "Autonomy Self Development Bridge",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "battlecruiser-autonomous-mission",
    "file": "tests/battlecruiser-autonomous-mission.test.js",
    "title": "Battlecruiser Autonomous Mission",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-promotion-gate",
    "file": "tests/battlecruiser-promotion-gate.test.js",
    "title": "Battlecruiser Promotion Gate",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-regression-gate",
    "file": "tests/battlecruiser-regression-gate.test.js",
    "title": "Battlecruiser Regression Gate",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-runtime-bridge",
    "file": "tests/battlecruiser-runtime-bridge.test.js",
    "title": "Battlecruiser Runtime Bridge",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-runtime-governance-v1",
    "file": "tests/battlecruiser-runtime-governance-v1.test.js",
    "title": "Battlecruiser Runtime Governance V",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-rwht-routing-v1",
    "file": "tests/battlecruiser-rwht-routing-v1.test.js",
    "title": "Battlecruiser Rwht Routing V",
    "category": "BattleCruiser",
    "includedInNpmTest": false,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "battlecruiser-sandbox-controller",
    "file": "tests/battlecruiser-sandbox-controller.test.js",
    "title": "Battlecruiser Sandbox Controller",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones en la integración, sandbox, routing, promoción y conexión ARIA ↔ BattleCruiser."
  },
  {
    "id": "bitrise-connector",
    "file": "tests/bitrise-connector.test.js",
    "title": "Bitrise Connector",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "bitrise-runtime-contract",
    "file": "tests/bitrise-runtime-contract.test.js",
    "title": "Bitrise Runtime Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-1-aria-core",
    "file": "tests/block-1-aria-core.test.js",
    "title": "Block 1 Aria Core",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-2-tool-universe",
    "file": "tests/block-2-tool-universe.test.js",
    "title": "Block 2 Tool Universe",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-3-real-connectors",
    "file": "tests/block-3-real-connectors.test.js",
    "title": "Block 3 Real Connectors",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-4-execution-engine",
    "file": "tests/block-4-execution-engine.test.js",
    "title": "Block 4 Execution Engine",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-5-self-development",
    "file": "tests/block-5-self-development.test.js",
    "title": "Block 5 Self Development",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-6-autonomy",
    "file": "tests/block-6-autonomy.test.js",
    "title": "Block 6 Autonomy",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-7-multi-ia",
    "file": "tests/block-7-multi-ia.test.js",
    "title": "Block 7 Multi Ia",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "block-8-multi-agent",
    "file": "tests/block-8-multi-agent.test.js",
    "title": "Block 8 Multi Agent",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "block-9-platform",
    "file": "tests/block-9-platform.test.js",
    "title": "Block 9 Platform",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-a-integrity",
    "file": "tests/block-a-integrity.test.js",
    "title": "Block A Integrity",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "block-b-security",
    "file": "tests/block-b-security.test.js",
    "title": "Block B Security",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "block-b",
    "file": "tests/block-b.test.js",
    "title": "Block B",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "block-c-security",
    "file": "tests/block-c-security.test.js",
    "title": "Block C Security",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "block-c",
    "file": "tests/block-c.test.js",
    "title": "Block C",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "canonical-runtime",
    "file": "tests/canonical-runtime.test.js",
    "title": "Canonical Runtime",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "capability-audit-v1",
    "file": "tests/capability-audit-v1.test.js",
    "title": "Capability Audit V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "capability-matrix",
    "file": "tests/capability-matrix.test.js",
    "title": "Capability Matrix",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "certification-label-integrity",
    "file": "tests/certification-label-integrity.test.js",
    "title": "Certification Label Integrity",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "cloudflare-admin-endpoint",
    "file": "tests/cloudflare-admin-endpoint.test.js",
    "title": "Cloudflare Admin Endpoint",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "cloudflare-admin",
    "file": "tests/cloudflare-admin.test.js",
    "title": "Cloudflare Admin",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "cloudflare-provider-adapter-live",
    "file": "tests/cloudflare-provider-adapter-live.test.js",
    "title": "Cloudflare Provider Adapter Live",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "cloudflare-runtime-adapter-v2",
    "file": "tests/cloudflare-runtime-adapter-v2.test.js",
    "title": "Cloudflare Runtime Adapter V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "cloudflare-token-factory",
    "file": "tests/cloudflare-token-factory.test.js",
    "title": "Cloudflare Token Factory",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "cognitive-loop-v2",
    "file": "tests/cognitive-loop-v2.test.js",
    "title": "Cognitive Loop V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "computer-use-runtime-v1",
    "file": "tests/computer-use-runtime-v1.test.js",
    "title": "Computer Use Runtime V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "continuous-self-improvement-v1",
    "file": "tests/continuous-self-improvement-v1.test.js",
    "title": "Continuous Self Improvement V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "credential-boundary",
    "file": "tests/credential-boundary.test.js",
    "title": "Credential Boundary",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "credential-provider-manager",
    "file": "tests/credential-provider-manager.test.js",
    "title": "Credential Provider Manager",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "desktop-autonomy-loop",
    "file": "tests/desktop-autonomy-loop.test.js",
    "title": "Desktop Autonomy Loop",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "device-dispatcher",
    "file": "tests/device-dispatcher.test.js",
    "title": "Device Dispatcher",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "device-job-contract",
    "file": "tests/device-job-contract.test.js",
    "title": "Device Job Contract",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "device-universe-v1",
    "file": "tests/device-universe-v1.test.js",
    "title": "Device Universe V",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "durable-session",
    "file": "tests/durable-session.test.js",
    "title": "Durable Session",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "dynamic-goal-engine",
    "file": "tests/dynamic-goal-engine.test.js",
    "title": "Dynamic Goal Engine",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "eas-runner-patch",
    "file": "tests/eas-runner-patch.test.js",
    "title": "Eas Runner Patch",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "eas-universal-executor",
    "file": "tests/eas-universal-executor.test.js",
    "title": "Eas Universal Executor",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "evaluation-contract-v2",
    "file": "tests/evaluation-contract-v2.test.js",
    "title": "Evaluation Contract V",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "evaluation-engine-v2",
    "file": "tests/evaluation-engine-v2.test.js",
    "title": "Evaluation Engine V",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "evaluation-engine",
    "file": "tests/evaluation-engine.test.js",
    "title": "Evaluation Engine",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "evaluation-ledger",
    "file": "tests/evaluation-ledger.test.js",
    "title": "Evaluation Ledger",
    "category": "Memoria / evaluación",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "evaluation-self-model-v2.integration",
    "file": "tests/evaluation-self-model-v2.integration.test.js",
    "title": "Evaluation Self Model V.Integration",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "evidence-driven-self-improvement-v1",
    "file": "tests/evidence-driven-self-improvement-v1.test.js",
    "title": "Evidence Driven Self Improvement V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "evidence-ledger-v1",
    "file": "tests/evidence-ledger-v1.test.js",
    "title": "Evidence Ledger V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "execution-job-lease-recovery-contract",
    "file": "tests/execution-job-lease-recovery-contract.test.js",
    "title": "Execution Job Lease Recovery Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "execution-request",
    "file": "tests/execution-request.test.js",
    "title": "Execution Request",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "execution",
    "file": "tests/execution.test.js",
    "title": "Execution",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "failure-escalation",
    "file": "tests/failure-escalation.test.js",
    "title": "Failure Escalation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "failure-prevention-learning-v1",
    "file": "tests/failure-prevention-learning-v1.test.js",
    "title": "Failure Prevention Learning V",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "fallback-current",
    "file": "tests/fallback-current.test.js",
    "title": "Fallback Current",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "fallback",
    "file": "tests/fallback.test.js",
    "title": "Fallback",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "fast-lane",
    "file": "tests/fast-lane.test.js",
    "title": "Fast Lane",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "frontier-foundation",
    "file": "tests/frontier-foundation.test.js",
    "title": "Frontier Foundation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "frontier-v3",
    "file": "tests/frontier-v3.test.js",
    "title": "Frontier V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "gemini-adapter",
    "file": "tests/gemini-adapter.test.js",
    "title": "Gemini Adapter",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "github-app-installation-scope",
    "file": "tests/github-app-installation-scope.test.js",
    "title": "Github App Installation Scope",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "github-app-read-tool-surface",
    "file": "tests/github-app-read-tool-surface.test.js",
    "title": "Github App Read Tool Surface",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "github-app-runtime",
    "file": "tests/github-app-runtime.test.js",
    "title": "Github App Runtime",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "github-branch-workspace",
    "file": "tests/github-branch-workspace.test.js",
    "title": "Github Branch Workspace",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "goal-semantic-verifier",
    "file": "tests/goal-semantic-verifier.test.js",
    "title": "Goal Semantic Verifier",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "google-gemini-credential-adapter",
    "file": "tests/google-gemini-credential-adapter.test.js",
    "title": "Google Gemini Credential Adapter",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "governance",
    "file": "tests/governance.test.js",
    "title": "Governance",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "grok-optional-certification-contract",
    "file": "tests/grok-optional-certification-contract.test.js",
    "title": "Grok Optional Certification Contract",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "health-availability",
    "file": "tests/health-availability.test.js",
    "title": "Health Availability",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "health-http-probe",
    "file": "tests/health-http-probe.test.js",
    "title": "Health Http Probe",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "health-probe",
    "file": "tests/health-probe.test.js",
    "title": "Health Probe",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "idea-to-mission",
    "file": "tests/idea-to-mission.test.js",
    "title": "Idea To Mission",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "identity-credential-manager",
    "file": "tests/identity-credential-manager.test.js",
    "title": "Identity Credential Manager",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "intelligent-router-current",
    "file": "tests/intelligent-router-current.test.js",
    "title": "Intelligent Router Current",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },