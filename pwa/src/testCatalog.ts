export type TestCatalogItem = {
  id: string;
  file: string;
  title: string;
  category: string;
  includedInNpmTest: boolean;
  how: string;
  capabilities: string;
};

export const TEST_CATALOG_VERSION = '2026-10-10-canonical';
export const TEST_CATALOG: TestCatalogItem[] = [
  {
    "id": "aria-cuevacoin-oauth-callback",
    "file": "tests/aria-cuevacoin-oauth-callback.test.js",
    "title": "ARIA CuevaCoin OAuth Callback",
    "category": "Seguridad / OAuth",
    "includedInNpmTest": true,
    "how": "Verifica la ruta real de callback, las comprobaciones de estado y emisor, y el contrato CSP de la verificación OAuth gobernada.",
    "capabilities": "Detecta regresiones donde el Worker pierde los parámetros de callback y la autorización termina en /mcp sin completar el intercambio PKCE."
  },
  {
    "id": "omniroute-phase6-adapter",
    "file": "tests/omniroute-adapter.test.js",
    "title": "OmniRoute Phase 6 Adapter",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el adaptador gobernado entre ARIA Execution y OmniRoute sin habilitar OmniRoute como runtime global.",
    "capabilities": "Valida identidad del adapter, credencial inyectada, endpoint loopback, traducción OpenAI-compatible, errores fail-closed, metadata segura y ausencia de retry."
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
    "id": "lacueva-recovery-contract",
    "file": "tests/lacueva-recovery-contract.test.js",
    "title": "LaCueva Recovery Contract",
    "category": "Windows / recursos / recuperación",
    "includedInNpmTest": true,
    "how": "Comprueba que la recuperación de LaCueva mantenga el nodo como worker ligero, deshabilite Ollama y use únicamente la tarea canónica del agente.",
    "capabilities": "Detecta regresiones de identidad, autostart, Ollama, recuperación y protección de nodos Windows de bajos recursos."
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
    "id": "meditation-android-notification-routing-contract",
    "file": "tests/meditation-android-notification-routing-contract.test.js",
    "title": "Meditation Android Notification + Model Routing Contract",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el contrato de notificaciones Android y que las rutas Qwen locales dependan de una capacidad física LIVE compatible.",
    "capabilities": "Detecta desalineación entre Planner, runner, device capabilities, enqueue Android y rutas locales de modelo."
  },
  {
    "id": "meditation-android-claim-capability-alias-contract",
    "file": "tests/meditation-android-claim-capability-alias-contract.test.js",
    "title": "Meditation Android Claim Capability Alias Contract",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba que el claim canónico traduzca android.notification a notifications.push al seleccionar jobs.",
    "capabilities": "Detecta desalineación entre operación de job y capability física durante el claim del agente."
  },
  {
    "id": "android-termux-notification-direct-fallback-contract",
    "file": "tests/android-termux-notification-direct-fallback-contract.test.js",
    "title": "Android Termux Notification Direct Fallback Contract",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el fallback directo a libexec/termux-api cuando termux-notification falla por incompatibilidad de getopt.",
    "capabilities": "Evita que el CLI de notificaciones del dispositivo rompa el canal físico de Meditation IA por diferencias del entorno."
  },
  {
    "id": "android-termux-shell-resilience-contract",
    "file": "tests/android-termux-shell-resilience-contract.test.js",
    "title": "Android Termux Shell Resilience Contract",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba que la ejecución shell no dependa de una ruta fija de Bash en Termux y use fallbacks disponibles.",
    "capabilities": "Evita regresiones por cambios de rutas del entorno Termux/Android."
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
    "id": "mission-runner-v22-android-ui-verification",
    "file": "tests/mission-runner-v22-android-ui-verification.test.js",
    "title": "Mission Runner V22 Android UI Verification",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba que Computer Use Android se verifique mediante evidencia física del job y código de salida, no mediante response.content.",
    "capabilities": "Detecta falsos negativos de verificación en ejecución Android, evidencia física y estado terminal."
  },
  {
    "id": "mission-runner-v22-device-payload-sanitization",
    "file": "tests/mission-runner-v22-device-payload-sanitization.test.js",
    "title": "Mission Runner V22 Device Payload Sanitization",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que los campos internos del runner no se filtren hacia los payloads de dispositivos gobernados.",
    "capabilities": "Detecta regresiones de saneamiento de payload, dispatch de dispositivos y contratos Android/Windows."
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
    "id": "pwa-command-center-ux",
    "file": "tests/pwa-command-center-ux.test.js",
    "title": "PWA Command Center UX",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que Meditación IA muestre la misión que está en ejecución o esperando ejecución, que las ideas analizadas estén en una ventana separada y que Inicio permanezca reducido a lo esencial.",
    "capabilities": "Detecta regresiones de visibilidad de misión, exceso de contenido en Inicio, ideas analizadas ocupando espacio permanente y paneles operativos sin utilidad visible."
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
    "id": "aria-cuevacoin-control-v1",
    "file": "tests/aria-cuevacoin-control-v1.test.js",
    "title": "ARIA CuevaCoin Control v1",
    "category": "Seguridad / permisos",
    "includedInNpmTest": true,
    "how": "Comprueba el consentimiento OAuth elevado y las puertas de autorización para controlar CuevaCoin.",
    "capabilities": "Valida aislamiento del proyecto, persistencia de scopes, confirmaciones explícitas y no exposición de credenciales."
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
    "id": "battlecruiser-readonly-routing",
    "file": "tests/battlecruiser-readonly-routing.test.js",
    "title": "BattleCruiser Read-Only Routing",
    "category": "BattleCruiser",
    "includedInNpmTest": true,
    "how": "Comprueba que las prohibiciones de escritura no activen una ruta GitHub mutante.",
    "capabilities": "Protege el alcance de solo lectura del planificador y la integración ARIA ↔ BattleCruiser."
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
    "id": "gemini-direct-route-registry-v1",
    "file": "tests/gemini-direct-route-registry-v1.test.js",
    "title": "Gemini Direct Route Registry V1",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que la ruta Gemini Direct solo se habilite cuando el proveedor y la capability tienen evidencia vigente.",
    "capabilities": "Protege la reconciliación del model registry, evidencia LIVE y fail-closed del router."
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
  {
    "id": "intelligent-router-v2",
    "file": "tests/intelligent-router-v2.test.js",
    "title": "Intelligent Router V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "intelligent-router",
    "file": "tests/intelligent-router.test.js",
    "title": "Intelligent Router",
    "category": "IA / modelos / routing",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "interfaces-computer-plugin",
    "file": "tests/interfaces-computer-plugin.test.js",
    "title": "Interfaces Computer Plugin",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "live-device-client",
    "file": "tests/live-device-client.test.js",
    "title": "Live Device Client",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "mcp-gateway",
    "file": "tests/mcp-gateway.test.js",
    "title": "Mcp Gateway",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mcp-inbound-grok",
    "file": "tests/mcp-inbound-grok.test.js",
    "title": "Mcp Inbound Grok",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "mcp-router",
    "file": "tests/mcp-router.test.js",
    "title": "Mcp Router",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "meditation-android-notifications",
    "file": "tests/meditation-android-notifications.test.js",
    "title": "Meditation Android Notifications",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "meditation-chain-canonical-endpoint",
    "file": "tests/meditation-chain-canonical-endpoint.test.js",
    "title": "Meditation Chain Canonical Endpoint",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-db-tick-canonical-bridge",
    "file": "tests/meditation-db-tick-canonical-bridge.test.js",
    "title": "Meditation Db Tick Canonical Bridge",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-ia-lock",
    "file": "tests/meditation-ia-lock.test.js",
    "title": "Meditation Ia Lock",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-ia-runtime-bridge",
    "file": "tests/meditation-ia-runtime-bridge.test.js",
    "title": "Meditation Ia Runtime Bridge",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-ia-surface",
    "file": "tests/meditation-ia-surface.test.js",
    "title": "Meditation Ia Surface",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-ia-verification-gate",
    "file": "tests/meditation-ia-verification-gate.test.js",
    "title": "Meditation Ia Verification Gate",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-ia",
    "file": "tests/meditation-ia.test.js",
    "title": "Meditation Ia",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-idea-to-mission-contract",
    "file": "tests/meditation-idea-to-mission-contract.test.js",
    "title": "Meditation Idea To Mission Contract",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-idea-to-mission-ui",
    "file": "tests/meditation-idea-to-mission-ui.test.js",
    "title": "Meditation Idea To Mission UI",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-notifications",
    "file": "tests/meditation-notifications.test.js",
    "title": "Meditation Notifications",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-pwa-notifications",
    "file": "tests/meditation-pwa-notifications.test.js",
    "title": "Meditation PWA Notifications",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-self-model-skill-bridge.contract",
    "file": "tests/meditation-self-model-skill-bridge.contract.test.js",
    "title": "Meditation Self Model Skill Bridge.Contract",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-stale-recovery-duplicate-guard",
    "file": "tests/meditation-stale-recovery-duplicate-guard.test.js",
    "title": "Meditation Stale Recovery Duplicate Guard",
    "category": "Meditación IA",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "meditation-human-queue-unblock-v1",
    "file": "tests/meditation-human-queue-unblock-v1.test.js",
    "title": "Meditation Human Queue Unblock V1",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba que la ejecución LIVE, la cola y la interfaz humana permanezcan separadas y recuperables.",
    "capabilities": "Comprueba estado de ejecución, cola, recuperación de misiones y presentación humana en Meditación IA."
  },
  {
    "id": "meditation-sync-contract-v1",
    "file": "tests/meditation-sync-contract-v1.test.js",
    "title": "Meditation Sync Contract V",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba sincronización, notificaciones, ideas→misiones, recursos y flujos de Meditación IA."
  },
  {
    "id": "memory-v2-contract",
    "file": "tests/memory-v2-contract.test.js",
    "title": "Memory V Contract",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "meta-reasoning-v1",
    "file": "tests/meta-reasoning-v1.test.js",
    "title": "Meta Reasoning V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-9-5-grok-discovery",
    "file": "tests/mission-9-5-grok-discovery.test.js",
    "title": "Mission 9 5 Grok Discovery",
    "category": "IA / modelos / routing",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "mission-9-5-grok-provisioning",
    "file": "tests/mission-9-5-grok-provisioning.test.js",
    "title": "Mission 9 5 Grok Provisioning",
    "category": "IA / modelos / routing",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "mission-9-5",
    "file": "tests/mission-9-5.test.js",
    "title": "Mission 9 5",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-chain-event-type-contract",
    "file": "tests/mission-chain-event-type-contract.test.js",
    "title": "Mission Chain Event Type Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-chain-evidence-contract",
    "file": "tests/mission-chain-evidence-contract.test.js",
    "title": "Mission Chain Evidence Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-claim-same-worker-reentry",
    "file": "tests/mission-claim-same-worker-reentry.test.js",
    "title": "Mission Claim Same Worker Reentry",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-correctness-v1",
    "file": "tests/mission-correctness-v1.test.js",
    "title": "Mission Correctness V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-entrypoint",
    "file": "tests/mission-entrypoint.test.js",
    "title": "Mission Entrypoint",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-event-evidence-hotpath",
    "file": "tests/mission-event-evidence-hotpath.test.js",
    "title": "Mission Event Evidence Hotpath",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-event-persistence-timeout-resilience",
    "file": "tests/mission-event-persistence-timeout-resilience.test.js",
    "title": "Mission Event Persistence Timeout Resilience",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-http",
    "file": "tests/mission-http.test.js",
    "title": "Mission Http",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v17-parallel-contract",
    "file": "tests/mission-runner-v17-parallel-contract.test.js",
    "title": "Mission Runner V Parallel Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-actionable-verification",
    "file": "tests/mission-runner-v22-actionable-verification.test.js",
    "title": "Mission Runner V Actionable Verification",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-auth-propagation",
    "file": "tests/mission-runner-v22-auth-propagation.test.js",
    "title": "Mission Runner V Auth Propagation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-model-fallback",
    "file": "tests/mission-runner-v22-model-fallback.test.js",
    "title": "Mission Runner V Model Fallback",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "mission-runner-v22-recovery-isolation",
    "file": "tests/mission-runner-v22-recovery-isolation.test.js",
    "title": "Mission Runner V Recovery Isolation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-recovery",
    "file": "tests/mission-runner-v22-recovery.test.js",
    "title": "Mission Runner V Recovery",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-rwht-load-guard",
    "file": "tests/mission-runner-v22-rwht-load-guard.test.js",
    "title": "Mission Runner V Rwht Load Guard",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-runner-v22-verified-terminalization",
    "file": "tests/mission-runner-v22-verified-terminalization.test.js",
    "title": "Mission Runner V Verified Terminalization",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-state",
    "file": "tests/mission-state.test.js",
    "title": "Mission State",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission-write-intent-routing",
    "file": "tests/mission-write-intent-routing.test.js",
    "title": "Mission Write Intent Routing",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que las misiones de creación de artefactos no se desvíen hacia una revisión de solo lectura por lenguaje ambiguo.",
    "capabilities": "Detecta regresiones donde términos como “revisable” provoquen una ruta de reviewer en lugar del ejecutor de implementación gobernado."
  },
  {
    "id": "mission5-agent-expansion",
    "file": "tests/mission5-agent-expansion.test.js",
    "title": "Mission5 Agent Expansion",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission5-device-e2e-probe",
    "file": "tests/mission5-device-e2e-probe.test.js",
    "title": "Mission5 Device E2e Probe",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "mission5-resource-runtime",
    "file": "tests/mission5-resource-runtime.test.js",
    "title": "Mission5 Resource Runtime",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "mission6-router-v2-gateway-contract",
    "file": "tests/mission6-router-v2-gateway-contract.test.js",
    "title": "Mission6 Router V Gateway Contract",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "mission7-autonomy-loop",
    "file": "tests/mission7-autonomy-loop.test.js",
    "title": "Mission7 Autonomy Loop",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "model-registry",
    "file": "tests/model-registry.test.js",
    "title": "Model Registry",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "multi-agent-runtime-v2",
    "file": "tests/multi-agent-runtime-v2.test.js",
    "title": "Multi Agent Runtime V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "multi-agent-v2-security",
    "file": "tests/multi-agent-v2-security.test.js",
    "title": "Multi Agent V Security",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "multi-agent-v2",
    "file": "tests/multi-agent-v2.test.js",
    "title": "Multi Agent V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "multimodal-v1",
    "file": "tests/multimodal-v1.test.js",
    "title": "Multimodal V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "no-duplicate-cloudflare-cron",
    "file": "tests/no-duplicate-cloudflare-cron.test.js",
    "title": "No Duplicate Cloudflare Cron",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "normalize",
    "file": "tests/normalize.test.js",
    "title": "Normalize",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "oauth-crypto",
    "file": "tests/oauth-crypto.test.js",
    "title": "Oauth Crypto",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "observability",
    "file": "tests/observability.test.js",
    "title": "Observability",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "orchestration-v3",
    "file": "tests/orchestration-v3.test.js",
    "title": "Orchestration V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "orchestrator-parallel-graph",
    "file": "tests/orchestrator-parallel-graph.test.js",
    "title": "Orchestrator Parallel Graph",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "otel-mapping",
    "file": "tests/otel-mapping.test.js",
    "title": "Otel Mapping",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "performance-intelligence-v1",
    "file": "tests/performance-intelligence-v1.test.js",
    "title": "Performance Intelligence V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "planner-credential-health",
    "file": "tests/planner-credential-health.test.js",
    "title": "Planner Credential Health",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "planner-v10-path-contract",
    "file": "tests/planner-v10-path-contract.test.js",
    "title": "Planner V Path Contract",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "planner-v11-android-autonomous",
    "file": "tests/planner-v11-android-autonomous.test.js",
    "title": "Planner V Android Autonomous",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "planner-v11-live-sync",
    "file": "tests/planner-v11-live-sync.test.js",
    "title": "Planner V Live Sync",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "planner-v11-local-qwen-capability",
    "file": "tests/planner-v11-local-qwen-capability.test.js",
    "title": "Planner V11 Local Qwen Capability",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que la ruta local Qwen solo se seleccione cuando exista una capacidad LIVE compatible.",
    "capabilities": "Detecta regresiones en selección de modelos, capacidades de dispositivos y routing local."
  },
  {
    "id": "project-chat-compact-v1",
    "file": "tests/project-chat-compact-v1.test.js",
    "title": "Project Chat Compact V",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "project-chat-processing-persistence-v1",
    "file": "tests/project-chat-processing-persistence-v1.test.js",
    "title": "Project Chat Processing Persistence V",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "project-conversation-lookup-v1",
    "file": "tests/project-conversation-lookup-v1.test.js",
    "title": "Project Conversation Lookup V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "pwa-auth-proxy-contract",
    "file": "tests/pwa-auth-proxy-contract.test.js",
    "title": "PWA Auth Proxy Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "pwa-global-navigation-settings-v1",
    "file": "tests/pwa-global-navigation-settings-v1.test.js",
    "title": "PWA Global Navigation Settings V",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "pwa-project-workspace",
    "file": "tests/pwa-project-workspace.test.js",
    "title": "PWA Project Workspace",
    "category": "PWA / UX / API",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "pwa-rwht-repair-routing-notification-contract",
    "file": "tests/pwa-rwht-repair-routing-notification-contract.test.js",
    "title": "PWA Rwht Repair Routing Notification Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "pwa-rwht-surface-contract",
    "file": "tests/pwa-rwht-surface-contract.test.js",
    "title": "PWA Rwht Surface Contract",
    "category": "PWA / UX / API",
    "includedInNpmTest": false,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta regresiones de interfaz, navegación, persistencia, contratos del API y experiencia PWA."
  },
  {
    "id": "quota-capacity-v1-1",
    "file": "tests/quota-capacity-v1-1.test.js",
    "title": "Quota Capacity V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "quota-capacity",
    "file": "tests/quota-capacity.test.js",
    "title": "Quota Capacity",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "real-activation-bootstrap",
    "file": "tests/real-activation-bootstrap.test.js",
    "title": "Real Activation Bootstrap",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "real-activation",
    "file": "tests/real-activation.test.js",
    "title": "Real Activation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "recovery-replan-state-consistency",
    "file": "tests/recovery-replan-state-consistency.test.js",
    "title": "Recovery Replan State Consistency",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "resource-intelligence-v1",
    "file": "tests/resource-intelligence-v1.test.js",
    "title": "Resource Intelligence V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "router-economic-overlay-v1",
    "file": "tests/router-economic-overlay-v1.test.js",
    "title": "Router Economic Overlay V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "router-meta-overlay-v1",
    "file": "tests/router-meta-overlay-v1.test.js",
    "title": "Router Meta Overlay V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "router-vision-v1",
    "file": "tests/router-vision-v1.test.js",
    "title": "Router Vision V1",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba la ruta primaria LIVE, la preparación de un segundo proveedor como fallback y las barreras contra proveedores no verificados.",
    "capabilities": "Valida selección determinista, fallback multi-proveedor, bloqueo de Mistral sin generación LIVE y gobernanza explícita de rate limits."
  },
  {
    "id": "security-v2",
    "file": "tests/security-v2.test.js",
    "title": "Security V",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "self-development-evaluation-ledger",
    "file": "tests/self-development-evaluation-ledger.test.js",
    "title": "Self Development Evaluation Ledger",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "self-development-github-lifecycle",
    "file": "tests/self-development-github-lifecycle.test.js",
    "title": "Self Development Github Lifecycle",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "self-development-v2",
    "file": "tests/self-development-v2.test.js",
    "title": "Self Development V",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "self-model-v2",
    "file": "tests/self-model-v2.test.js",
    "title": "Self Model V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "self-model-router-evidence-contract",
    "file": "tests/self-model-router-evidence-contract.test.js",
    "title": "Self Model Router Evidence Contract",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba que Self-Model conserve el estado de selección de rutas cuando existe evidencia y respete no_route cuando ninguna ruta está disponible.",
    "capabilities": "Detecta regresiones en routing fail-closed, integración con Self-Model y sincronización entre registries y capacidades."
  },
  {
    "id": "human-gate-same-tick-checkpoint-regression",
    "file": "tests/human-gate-same-tick-checkpoint-regression.test.js",
    "title": "Human Gate Same Tick Checkpoint Regression",
    "category": "Misiones / Human Gate",
    "includedInNpmTest": true,
    "how": "Protege el contrato que obliga al runner a refrescar su snapshot de checkpoint antes de evaluar el siguiente batch.",
    "capabilities": "Detecta regresiones donde un paso protegido podría ejecutarse antes de que el estado Human Gate recién persistido sea visible en memoria."
  },
  {
    "id": "chat-immediate-local-persistence",
    "file": "tests/chat-immediate-local-persistence.test.js",
    "title": "Chat Immediate Local Persistence",
    "category": "RWHT / Chat / Persistence",
    "includedInNpmTest": true,
    "how": "Protege la persistencia inmediata del mensaje de usuario antes del POST asíncrono a la conversación.",
    "capabilities": "Evita pérdida del mensaje durante procesamiento local de larga duración y recarga del navegador."
  },
  {
    "id": "self-model",
    "file": "tests/self-model.test.js",
    "title": "Self Model",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "skills-learning-v2",
    "file": "tests/skills-learning-v2.test.js",
    "title": "Skills Learning V",
    "category": "Memoria / evaluación",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba memoria, self-model, world-model, aprendizaje, evaluación y observabilidad."
  },
  {
    "id": "smart-verifier",
    "file": "tests/smart-verifier.test.js",
    "title": "Smart Verifier",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "strategic-goal-completion",
    "file": "tests/strategic-goal-completion.test.js",
    "title": "Strategic Goal Completion",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "supabase-canonical-deploy-contract",
    "file": "tests/supabase-canonical-deploy-contract.test.js",
    "title": "Supabase Canonical Deploy Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "supabase-backpressure-contract",
    "file": "tests/supabase-backpressure-contract.test.js",
    "title": "Supabase Backpressure Contract",
    "category": "Supabase / estabilidad",
    "includedInNpmTest": true,
    "how": "Verifica límites de polling, backoff, retries, caché de autenticación y cron escalonados del runtime.",
    "capabilities": "Detecta presión innecesaria sobre Supabase, reintentos agresivos y recuperación duplicada en el camino caliente."
  },
  {
    "id": "supabase-mission-repository",
    "file": "tests/supabase-mission-repository.test.js",
    "title": "Supabase Mission Repository",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "supabase-mission-runner-v18-contract",
    "file": "tests/supabase-mission-runner-v18-contract.test.js",
    "title": "Supabase Mission Runner V Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "termux-autostart-contract",
    "file": "tests/termux-autostart-contract.test.js",
    "title": "Termux Autostart Contract",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba que una interfaz o contrato estructural siga existiendo y no se rompa.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "tool-operation-plan",
    "file": "tests/tool-operation-plan.test.js",
    "title": "Tool Operation Plan",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "tool-registry",
    "file": "tests/tool-registry.test.js",
    "title": "Tool Registry",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u01",
    "file": "tests/universal-execution-u01.test.js",
    "title": "Universal Execution U01",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u02",
    "file": "tests/universal-execution-u02.test.js",
    "title": "Universal Execution U02",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u03-debug",
    "file": "tests/universal-execution-u03-debug.test.js",
    "title": "Universal Execution U03 Debug",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u03",
    "file": "tests/universal-execution-u03.test.js",
    "title": "Universal Execution U03",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u04",
    "file": "tests/universal-execution-u04.test.js",
    "title": "Universal Execution U04",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u05",
    "file": "tests/universal-execution-u05.test.js",
    "title": "Universal Execution U05",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u06",
    "file": "tests/universal-execution-u06.test.js",
    "title": "Universal Execution U06",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u07",
    "file": "tests/universal-execution-u07.test.js",
    "title": "Universal Execution U07",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u08-live",
    "file": "tests/universal-execution-u08-live.test.js",
    "title": "Universal Execution U08 Live",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Ejecuta una comprobación más cercana a runtime/entorno real y valida el resultado observable.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u09",
    "file": "tests/universal-execution-u09.test.js",
    "title": "Universal Execution U09",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-execution-u10",
    "file": "tests/universal-execution-u10.test.js",
    "title": "Universal Execution U10",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-executor",
    "file": "tests/universal-executor.test.js",
    "title": "Universal Executor",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-mission",
    "file": "tests/universal-mission.test.js",
    "title": "Universal Mission",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Comprueba orquestación, misiones, executors, recuperación, persistencia y ejecución universal."
  },
  {
    "id": "universal-windows-qwen3",
    "file": "tests/universal-windows-qwen3.test.js",
    "title": "Universal Windows Qwen3",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "windows-computer-use",
    "file": "tests/windows-computer-use.test.js",
    "title": "Windows Computer Use",
    "category": "Android / dispositivos",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "windows-shell-executor",
    "file": "tests/windows-shell-executor.test.js",
    "title": "Windows Shell Executor",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Verifica que una ruta de ejecución, executor o misión produzca el estado y las evidencias esperadas.",
    "capabilities": "Detecta problemas de accesibilidad, bridge, Termux, ejecución física y transporte en dispositivos."
  },
  {
    "id": "windows-agent-lifecycle-telemetry",
    "file": "tests/windows-agent-lifecycle-telemetry.test.js",
    "title": "Windows Agent Lifecycle Telemetry",
    "category": "Android / dispositivos",
    "includedInNpmTest": false,
    "how": "Verifica que el ciclo de vida del job Windows persista start/result antes de la telemetría no crítica.",
    "capabilities": "Detecta bloqueos del agente, telemetría no crítica y pérdida de estados started/completed."
  },
  {
    "id": "windows-agent-resource-guard",
    "file": "tests/windows-agent-resource-guard.test.js",
    "title": "Windows Agent Resource Guard",
    "category": "Windows / rendimiento",
    "includedInNpmTest": true,
    "how": "Verifica que el agente Windows clasifique nodos débiles como worker-light y bloquee inferencia local cuando los recursos son insuficientes.",
    "capabilities": "Protege RAM/CPU, evita carga Ollama/Qwen indebida y comprueba que el instalador y runtime conserven la identidad Windows canónica."
  },
  {
    "id": "world-model-change-risk.integration",
    "file": "tests/world-model-change-risk.integration.test.js",
    "title": "World Model Change Risk.Integration",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "world-model-self-model-v2.integration",
    "file": "tests/world-model-self-model-v2.integration.test.js",
    "title": "World Model Self Model V.Integration",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "world-model-v2-security",
    "file": "tests/world-model-v2-security.test.js",
    "title": "World Model V Security",
    "category": "Seguridad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba límites, permisos, validaciones y fallos seguros antes de permitir una operación.",
    "capabilities": "Detecta operaciones no autorizadas, exposición de secretos, límites de riesgo y fallos no fail-closed."
  },
  {
    "id": "world-model-v2",
    "file": "tests/world-model-v2.test.js",
    "title": "World Model V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "world-model-v3",
    "file": "tests/world-model-v3.test.js",
    "title": "World Model V",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "xai-adapter",
    "file": "tests/xai-adapter.test.js",
    "title": "Xai Adapter",
    "category": "IA / modelos / routing",
    "includedInNpmTest": true,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "xai-registry-connection-state",
    "file": "tests/xai-registry-connection-state.test.js",
    "title": "Xai Registry Connection State",
    "category": "IA / modelos / routing",
    "includedInNpmTest": false,
    "how": "Comprueba el comportamiento específico indicado por el nombre del test y detecta regresiones.",
    "capabilities": "Valida selección de modelos, planner, routing, fallback, multi-IA y coordinación."
  },
  {
    "id": "phase3-canonical-runtime-contract",
    "file": "tests/phase3-canonical-runtime-contract.test.js",
    "title": "Phase 3 Canonical Runtime Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba la autoridad única del runtime y sus fronteras de error y salud efectiva.",
    "capabilities": "Comprueba planner, runner, gateway, execution, device, verification y separación PWA/dispositivo."
  },
  {
    "id": "phase4-jobs-recovery-contract",
    "file": "tests/phase4-jobs-recovery-contract.test.js",
    "title": "Phase 4 Jobs Recovery Contract",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba máquina de estados, watchdog, backpressure, idempotencia y límites deterministas de recuperación.",
    "capabilities": "Comprueba jobs, leases, reclaim, timeout, terminalización, retry con cambio de estrategia y saturación."
  },
  {
    "id": "operational-diagnostics",
    "file": "tests/operational-diagnostics.test.js",
    "title": "Operational Diagnostics",
    "category": "Diagnóstico / observabilidad",
    "includedInNpmTest": true,
    "how": "Comprueba correlación, clasificación de causa, historial de intentos, evidencia y redacción segura.",
    "capabilities": "Valida trace/request/execution IDs, raíz del fallo, dependencia, siguiente acción y evidencia sin secretos."
  },
  {
    "id": "aria-app-api-v3-diagnostics-contract",
    "file": "tests/aria-app-api-v3-diagnostics-contract.test.js",
    "title": "ARIA App API V3 Diagnostics Contract",
    "category": "Diagnóstico / observabilidad",
    "includedInNpmTest": true,
    "how": "Comprueba que el API exponga diagnóstico por misión y salud operativa y que la PWA propague identidad de ejecución.",
    "capabilities": "Detecta regresiones en diagnóstico humano, health dashboard, correlación y endpoints canónicos."
  },
  {
    "id": "phase5-diagnostics-db-contract",
    "file": "tests/phase5-diagnostics-db-contract.test.js",
    "title": "Phase 5 Diagnostics DB Contract",
    "category": "Diagnóstico / observabilidad",
    "includedInNpmTest": true,
    "how": "Comprueba columnas, índices, trigger y almacenamiento persistente del diagnóstico operacional.",
    "capabilities": "Valida la fuente persistente de correlation IDs, versiones, errores y evidencia."
  },
  {
    "id": "chatbending-operational-engine",
    "file": "tests/chatbending-operational-engine.test.js",
    "title": "ChatBending Operational Engine",
    "category": "ChatBending / continuidad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba el Mission Context, gates de conducta, escalamiento, cierre verificado y promoción controlada de aprendizajes.",
    "capabilities": "Valida continuidad, STOP ante contradicción, REVALIDATE por frescura, cambio de ruta tras fallos y no auto-promoción de reglas."
  },
  {
    "id": "chatbending-canonical-runtime-integration",
    "file": "tests/chatbending-canonical-runtime.integration.test.js",
    "title": "ChatBending Canonical Runtime Integration",
    "category": "ChatBending / continuidad / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba que el runtime canónico construya y transporte el contexto ChatBending y respete el gate de STOP cuando se exige.",
    "capabilities": "Valida el cableado Machine Layer → runtime sin depender de una sesión de chat concreta."
  },

  {
    "id": "mission-runner-v22-completed-progress-replan",
    "file": "tests/mission-runner-v22-completed-progress-replan.test.js",
    "title": "Mission Runner V22 Completed Progress + Replan",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Verifica que los steps ya completados y verificados sobrevivan a un replan y que la evidencia previa no recupere el step fallido.",
    "capabilities": "Detecta regresiones de continuidad, recuperación, replan, persistencia de evidencia y prevención de reinicio desde step 0."
  },
  {
    "id": "meditation-queue-state-machine",
    "file": "tests/meditation-queue-state-machine.test.js",
    "title": "Meditation Queue State Machine",
    "category": "Ejecución / misiones",
    "includedInNpmTest": false,
    "how": "Comprueba que las continuaciones no terminales permanezcan reanudables, que no exista fan-out de cola y que el scheduler tenga timeout explícito.",
    "capabilities": "Valida single-flight, reconciliación de cola, prioridad de objetivo principal, aceptación explícita del Idea Analyzer y recuperación de continuaciones."
  },
  {
    "id": "meditation-rwht-bounded-coverage-close",
    "file": "tests/meditation-rwht-bounded-coverage-close.test.js",
    "title": "Meditation RWHT Bounded Coverage Close",
    "category": "Meditación IA / RWHT",
    "includedInNpmTest": false,
    "how": "Comprueba que una corrida acotada que ya completó cobertura y verificación no termine falsamente como bounded_run_exhausted.",
    "capabilities": "Protege el cierre terminal de Meditation IA cuando la cobertura PWA y la evidencia ya están completas."
  },
  {
    "id": "meditation-windows-device-routing",
    "file": "tests/meditation-windows-device-routing.test.js",
    "title": "Meditation Windows Device Routing",
    "category": "Meditación IA / RWHT",
    "includedInNpmTest": true,
    "how": "Comprueba que una misión Meditation con dispositivo Windows explícito no sea desviada al planner Android.",
    "capabilities": "Protege la selección determinista de dispositivo y evita drift Windows→Android en pruebas PWA."
  },
  {
    "id": "mistral-adapter",
    "file": "tests/mistral-adapter.test.js",
    "title": "Mistral Direct Provider Adapter",
    "category": "Multi-IA / proveedores",
    "includedInNpmTest": true,
    "how": "Comprueba el contrato de request/response, autenticación Bearer, normalización de uso y no filtrado de secretos del adaptador Mistral Direct.",
    "capabilities": "Valida que Mistral quede conectado al Execution Engine sin inventar cuentas, cuotas o rutas seleccionables."
  },

  {
    "id": "ecc-operator",
    "file": "tests/ecc-operator.test.js",
    "title": "ECC Operator",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba la interfaz gobernada que traduce acciones permitidas de ECC a la frontera de ejecución de dispositivos de ARIA.",
    "capabilities": "Valida acciones permitidas de ECC, targets permitidos, generación determinista de comandos, dry-run y rechazo de shell arbitrario."
  },
  {
    "id": "mission-runner-v22-ecc-async-poll-budget",
    "file": "tests/mission-runner-v22-ecc-async-poll-budget.test.js",
    "title": "Mission Runner V22 ECC Async Poll Budget",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que ECC no bloquea el request HTTP esperando más allá del presupuesto por tick y que el trabajo puede continuar mediante estado reanudable.",
    "capabilities": "Protege la ejecución de ECC frente a timeouts del transporte y conserva el polling de trabajos largos como continuación gobernada."
  },

  {
    "id": "mission-runner-v22-job-id-isolation",
    "file": "tests/mission-runner-v22-job-id-isolation.test.js",
    "title": "Mission Runner V22 Job ID Isolation",
    "category": "Ejecución / misiones",
    "includedInNpmTest": true,
    "how": "Comprueba que los identificadores de trabajos de ejecución permanecen aislados entre misiones incluso cuando comparten el mismo prefijo.",
    "capabilities": "Evita que dos misiones o dispositivos reutilicen accidentalmente el mismo job_id y mezclen resultados de ejecución."
  },

  {
    "id": "strategy-failure-memory-v1",
    "file": "tests/strategy-failure-memory-v1.test.js",
    "title": "Strategy Failure Memory V1",
    "category": "Memoria / evaluación",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato de memoria de fallos de estrategia y sus defensas de no-regresión.",
    "capabilities": "Detecta regresiones relacionadas con registrar estrategias fallidas, recuperar evidencia y evitar repetir rutas conocidas."
  },,

  {
    "id": "runtime-lane-integrity-v1",
    "file": "tests/runtime-lane-integrity-v1.test.js",
    "title": "Runtime Lane Integrity V1",
    "category": "Runtime / devices / evidence",
    "includedInNpmTest": true,
    "how": "Comprueba lanes físicas explícitas, evita ejecución cruzada entre dispositivos, limita E2E Windows a trusted-main y protege cola/evidencia.",
    "capabilities": "Protege identidad física, ownership de runners, selección de dispositivos, fairness de cola y cierre basado en evidencia."
  },
  {
    "id": "ecc-agent-adapter-layer",
    "file": "tests/ecc-agent-adapter-layer.test.js",
    "title": "ECC Agent Adapter Layer",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-agentshield",
    "file": "tests/ecc-agentshield.test.js",
    "title": "ECC AgentShield",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-autonomous-loop",
    "file": "tests/ecc-autonomous-loop.test.js",
    "title": "ECC Autonomous Loop",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-capability-compiler",
    "file": "tests/ecc-capability-compiler.test.js",
    "title": "ECC Capability Compiler",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-capability-registry",
    "file": "tests/ecc-capability-registry.test.js",
    "title": "ECC Capability Registry",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-context-resolver",
    "file": "tests/ecc-context-resolver.test.js",
    "title": "ECC Context Resolver",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-device-ownership",
    "file": "tests/ecc-device-ownership.test.js",
    "title": "ECC Device Ownership",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-drift-conflict",
    "file": "tests/ecc-drift-conflict.test.js",
    "title": "ECC Drift Conflict",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-failure-memory",
    "file": "tests/ecc-failure-memory.test.js",
    "title": "ECC Failure Memory",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-final-certification",
    "file": "tests/ecc-final-certification.test.js",
    "title": "ECC Final Certification",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-harness-audit",
    "file": "tests/ecc-harness-audit.test.js",
    "title": "ECC Harness Audit",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-hook-event-adapter",
    "file": "tests/ecc-hook-event-adapter.test.js",
    "title": "ECC Hook Event Adapter",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-inventory-compiler",
    "file": "tests/ecc-inventory-compiler.test.js",
    "title": "ECC Inventory Compiler",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-learning-adapter",
    "file": "tests/ecc-learning-adapter.test.js",
    "title": "ECC Learning Adapter",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-mcp-bridge",
    "file": "tests/ecc-mcp-bridge.test.js",
    "title": "ECC MCP Bridge",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-mission-graph",
    "file": "tests/ecc-mission-graph.test.js",
    "title": "ECC Mission Graph",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-plan-canvas",
    "file": "tests/ecc-plan-canvas.test.js",
    "title": "ECC Plan Canvas",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-regression-review",
    "file": "tests/ecc-regression-review.test.js",
    "title": "ECC Regression Review",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-session-contract",
    "file": "tests/ecc-session-contract.test.js",
    "title": "ECC Session Contract",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-skills-layer",
    "file": "tests/ecc-skills-layer.test.js",
    "title": "ECC Skills Layer",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-source-lock",
    "file": "tests/ecc-source-lock.test.js",
    "title": "ECC Source Lock",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": true,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-specialist-selection",
    "file": "tests/ecc-specialist-selection.test.js",
    "title": "ECC Specialist Selection",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-unified-memory",
    "file": "tests/ecc-unified-memory.test.js",
    "title": "ECC Unified Memory",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "ecc-verification-loop",
    "file": "tests/ecc-verification-loop.test.js",
    "title": "ECC Verification Loop",
    "category": "ECC / ejecución / gobierno",
    "includedInNpmTest": false,
    "how": "Comprueba el contrato específico de integración de ECC con ARIA y detecta regresiones.",
    "capabilities": "Valida gobernanza, ejecución controlada, contexto, memoria, verificación y continuidad de ECC."
  },
  {
    "id": "mission-planner-auth-forwarding",
    "file": "tests/mission-planner-auth-forwarding.test.js",
    "title": "Mission Planner Auth Forwarding",
    "category": "Mission / runtime / autenticación",
    "includedInNpmTest": false,
    "how": "Comprueba que la autenticación de servicio se propague correctamente al planificador de misiones.",
    "capabilities": "Valida continuidad de autenticación, planificación y ejecución canónica."
  },
  {
    "id": "mission-runner-recall-timeout",
    "file": "tests/mission-runner-recall-timeout.test.js",
    "title": "Mission Runner Recall Timeout",
    "category": "Mission / runtime / recuperación",
    "includedInNpmTest": false,
    "how": "Comprueba que el runner maneje correctamente timeouts durante la recuperación y recall de contexto.",
    "capabilities": "Valida resiliencia del runner, timeouts y continuidad de misiones."
  },
  {
    "id": "mission-runtime-integrity-v1",
    "file": "tests/mission-runtime-integrity-v1.test.js",
    "title": "Mission Runtime Integrity V1",
    "category": "Mission / runtime / ownership",
    "includedInNpmTest": true,
    "how": "Comprueba que la creación de misiones preserve el propietario autenticado, que el planificador multi-proyecto cubra todas las superficies solicitadas y que el recovery de replans atascados exista.",
    "capabilities": "Valida visibilidad de misión, planificación multi-proyecto y recuperación canónica del runner."
  },
  {
    "id": "mission-proof-governed-recovery",
    "file": "tests/mission-proof-governed-recovery.test.js",
    "title": "Mission Proof Governed Recovery",
    "category": "Mission / verificación / recuperación",
    "includedInNpmTest": false,
    "how": "Comprueba que el plan gobernado de recuperación de Mission Proof conserva rama, archivo y lectura física.",
    "capabilities": "Valida recuperación gobernada, escritura física en GitHub y coherencia del plan de verificación."
  },
  {
    "id": "mission-detail-v2",
    "file": "tests/mission-detail-v2.test.js",
    "title": "Mission Detail V2 — Human Recovery",
    "category": "Meditación IA",
    "includedInNpmTest": true,
    "how": "Comprueba que el detalle de una misión muestre el plan, fechas reales, estado terminal, diagnóstico humano, recuperación y evidencia técnica plegable.",
    "capabilities": "Detecta regresiones de UX y contrato en pasos de misión, Human Gate, reintento, cancelación, verificación y avisos."
  },
  {
    "id": "reality-board-contract",
    "file": "tests/reality-board-contract.test.js",
    "title": "ARIA Reality Board Truth Contract",
    "category": "Proyectos / verdad operativa",
    "includedInNpmTest": true,
    "how": "Comprueba que el panel Reality Board consulte fuentes actuales y no presente snapshots o estados LIVE/E2E hardcodeados como verdad.",
    "capabilities": "Detecta datos estáticos disfrazados de LIVE, ausencia de actualización automática, falta de detección de contradicciones y navegación incompleta al resultado."
  },
  {
    "id": "meditation-web-push",
    "file": "tests/meditation-web-push.test.js",
    "title": "Meditation IA Background Web Push",
    "category": "Meditation IA / notificaciones",
    "includedInNpmTest": true,
    "how": "Comprueba la suscripción persistente, el envío servidor-a-dispositivo y el manejo de notificaciones con la PWA cerrada.",
    "capabilities": "Valida Web Push en segundo plano, Service Worker, VAPID, persistencia de suscripciones y evidencia de entrega."
  },
];

export type TestCatalogStats = Readonly<{
  total: number;
  npmTest: number;
  catalogOnly: number;
  categories: readonly string[];
  catalogVersion: string;
}>;

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate test catalog ${label}: ${value}`);
    seen.add(value);
  }
}

const catalogIds = TEST_CATALOG.map(test => test.id);
const catalogFiles = TEST_CATALOG.map(test => test.file);
assertUnique(catalogIds, 'id');
assertUnique(catalogFiles, 'file');

const catalogCategories = Array.from(new Set(TEST_CATALOG.map(test => test.category))).sort();

export const TEST_CATALOG_STATS: TestCatalogStats = Object.freeze({
  total: TEST_CATALOG.length,
  npmTest: TEST_CATALOG.filter(test => test.includedInNpmTest).length,
  catalogOnly: TEST_CATALOG.filter(test => !test.includedInNpmTest).length,
  categoryCount: catalogCategories.length,
  categories: Object.freeze(catalogCategories),
  catalogVersion: TEST_CATALOG_VERSION
});

export function filterTestCatalog(query = '', category = 'Todas'): TestCatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return TEST_CATALOG.filter(test => {
    const categoryOk = category === 'Todas' || test.category === category;
    const queryOk = !normalizedQuery || JSON.stringify(test).toLowerCase().includes(normalizedQuery);
    return categoryOk && queryOk;
  });
}

// Baseline trigger marker 2026-10-01-v2. No runtime behavior change.
