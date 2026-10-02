const ECC_VERSION = "2.2.3";
const ALLOWED_ACTIONS = new Set(["consult", "doctor", "list_installed", "install_preview"]);
const ALLOWED_TARGETS = new Set(["codex", "claude", "kimi", "gemini", "qwen"]);
const ALLOWED_PROFILES = new Set(["minimal", "core"]);

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function psQuote(value: unknown) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function normalizeEccRequest(input: unknown = {}): PlainObject {
  if (!isPlainObject(input)) throw new TypeError("ecc input must be an object");
  const action = String(input.action || "").trim();
  if (!ALLOWED_ACTIONS.has(action)) throw new Error("ecc_action_not_allowed");

  const target = String(input.target || "codex").trim().toLowerCase();
  if (!ALLOWED_TARGETS.has(target)) throw new Error("ecc_target_not_allowed");

  if (action === "consult") {
    const topic = String(input.topic || "").trim();
    if (!topic || topic.length > 2000) throw new Error("ecc_consult_topic_invalid");
    return Object.freeze({ action, target, topic });
  }

  if (action === "install_preview") {
    const profile = String(input.profile || "minimal").trim().toLowerCase();
    if (!ALLOWED_PROFILES.has(profile)) throw new Error("ecc_profile_not_allowed");
    return Object.freeze({ action, target, profile });
  }

  return Object.freeze({ action, target });
}

export function buildEccShellCommand(input: unknown = {}) {
  const request = normalizeEccRequest(input);
  const base = `npx --yes ecc-universal@${ECC_VERSION}`;
  if (request.action === "consult") {
    return `${base} consult ${psQuote(request.topic)} --target ${request.target}`;
  }
  if (request.action === "doctor") {
    return `${base} doctor --target ${request.target}`;
  }
  if (request.action === "list_installed") {
    return `${base} list-installed`;
  }
  return `${base} install --profile ${request.profile} --target ${request.target} --dry-run`;
}

export function buildEccExecution(input: unknown = {}) {
  const request = normalizeEccRequest(input);
  return Object.freeze({
    tool_id: "tool_ecc_operator",
    operation: "ecc.execute",
    underlying_operation: "shell.execute",
    request,
    command: buildEccShellCommand(request),
  });
}
