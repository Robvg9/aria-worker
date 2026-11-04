/**
 * Mission Wonder 2 — Step 4
 * Validates that a PWA request_id still refers to the exact canonical user request.
 * Keep mission_state as the single source of truth; never create a second mission here.
 */
function normalizeGoal(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function missionRequestIdentityMatchesV1({
  mission,
  request_id,
  user_id,
  goal,
  project_id,
}) {
  if (!mission || typeof mission !== "object" || Array.isArray(mission)) return false;
  const metadata = mission.metadata && typeof mission.metadata === "object" && !Array.isArray(mission.metadata)
    ? mission.metadata
    : {};

  const requestId = typeof request_id === "string" ? request_id.trim() : "";
  const userId = typeof user_id === "string" ? user_id.trim() : "";
  if (!requestId || !userId) return false;

  // The caller also scopes its SQL read by request_id + user_id. Repeat those
  // checks here so this helper remains safe if another caller reuses it later.
  if (String(metadata.request_id ?? "") !== requestId) return false;
  if (String(metadata.user_id ?? "") !== userId) return false;
  if (metadata.owner_user_id != null && String(metadata.owner_user_id) !== userId) return false;

  // A retry is only idempotent when it describes the same user intent and project.
  if (normalizeGoal(mission.goal) !== normalizeGoal(goal)) return false;
  if (normalizeProjectId(metadata.project_id) !== normalizeProjectId(project_id)) return false;

  return true;
}
