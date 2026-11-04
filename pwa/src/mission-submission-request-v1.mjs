const STORAGE_KEY = "aria.pwa.mission-request.v1:pending";

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectId(value) {
  if (value === null || value === undefined) return null;
  const projectId = String(value).trim();
  return projectId || null;
}

async function identityKey({ userId, goal, projectId }) {
  const payload = JSON.stringify({
    version: 1,
    user_id: normalize(userId),
    goal: normalize(goal),
    project_id: normalizeProjectId(projectId),
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function readPending(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new Error("mission_request_storage_read_failed");
  }
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("mission_request_storage_corrupt");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("mission_request_storage_corrupt");
  }
  return parsed;
}

function isValidEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.request_id !== "string" || !entry.request_id.trim()) return false;
  const createdAt = Number(entry.created_at);
  // Pending identities do not expire automatically: a timeout can remain
  // ambiguous for longer than a day. Only canonical acknowledgement clears one.
  return Number.isFinite(createdAt);
}

function writePending(storage, key, entries) {
  const ordered = Object.entries(entries)
    .sort((a, b) => Number(a[1]?.created_at ?? 0) - Number(b[1]?.created_at ?? 0));
  if (ordered.length) {
    storage.setItem(key, JSON.stringify(Object.fromEntries(ordered)));
  } else {
    storage.removeItem(key);
  }
}

async function withIdentityLock(lockName, work) {
  const lockManager = globalThis.navigator && globalThis.navigator.locks;
  if (lockManager && typeof lockManager.request === "function") {
    return lockManager.request(lockName, { mode: "exclusive" }, work);
  }
  // The map read/write below is synchronous after the digest promise resolves.
  // Older browsers without Web Locks still serialize callbacks within one tab.
  return work();
}

function assertIntent({ userId, goal }) {
  if (!normalize(userId)) throw new Error("mission_request_user_required");
  if (!normalize(goal)) throw new Error("mission_request_goal_required");
  if (!globalThis.crypto?.subtle) throw new Error("mission_request_crypto_unavailable");
}

/**
 * Reuses a pending request ID for the same authenticated user's exact mission intent.
 * The goal is hashed before storage; raw mission text and credentials are never stored.
 * A successful API acknowledgement must call clearMissionSubmissionRequestIdV1.
 */
export async function getOrCreateMissionSubmissionRequestIdV1({
  userId,
  goal,
  projectId = null,
  storage = globalThis.localStorage,
  now = () => Date.now(),
  createRequestId = () => globalThis.crypto.randomUUID(),
}) {
  assertIntent({ userId, goal });
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new Error("mission_request_storage_unavailable");
  }

  const normalized = {
    userId: normalize(userId),
    goal: normalize(goal),
    projectId: normalizeProjectId(projectId),
  };
  const digest = await identityKey(normalized);
  const key = STORAGE_KEY;
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw new Error("mission_request_clock_invalid");

  return withIdentityLock("aria-mission-request-v1:" + normalized.userId + ":" + digest, async () => {
    const current = readPending(storage, key);
    const pending = Object.fromEntries(
      Object.entries(current).filter(([, entry]) => isValidEntry(entry))
    );
    const existing = pending[digest];
    if (existing?.request_id) {
      writePending(storage, key, pending);
      return existing.request_id;
    }

    const requestId = String(createRequestId() ?? "").trim();
    if (!requestId) throw new Error("mission_request_id_generation_failed");
    pending[digest] = { request_id: requestId, created_at: nowMs };
    writePending(storage, key, pending);
    return requestId;
  });
}

export async function clearMissionSubmissionRequestIdV1({
  userId,
  goal,
  projectId = null,
  storage = globalThis.localStorage,
  now = () => Date.now(),
}) {
  assertIntent({ userId, goal });
  if (!storage || typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new Error("mission_request_storage_unavailable");
  }

  const normalized = {
    userId: normalize(userId),
    goal: normalize(goal),
    projectId: normalizeProjectId(projectId),
  };
  const digest = await identityKey(normalized);
  const key = STORAGE_PREFIX + normalized.userId;
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw new Error("mission_request_clock_invalid");

  const current = readPending(storage, key);
  const fresh = Object.fromEntries(
    Object.entries(current).filter(([, entry]) => isValidEntry(entry, nowMs))
  );
  delete fresh[digest];
  writePending(storage, key, fresh);
}
