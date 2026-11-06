import fs from "node:fs";
import path from "node:path";

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || "");
const ACCESS_TOKEN = String(process.env.SUPABASE_ACCESS_TOKEN || "");
const EMAIL = String(process.env.RWHT_EMAIL || "");
const PASSWORD = String(process.env.RWHT_PASSWORD || "");
const MISSION_ID = "mission_a4_authorized_once";
const EXPECTED_USER_ID = "39a8f5fd-18e6-4bba-bdd3-31691ec18f3e";
const MISSION_API = "https://aria.robvg9.workers.dev/api/missions/" + encodeURIComponent(MISSION_ID);
const NOTIFICATIONS_API = "https://aria.robvg9.workers.dev/api/meditation/notifications?limit=50";
const OUT = path.resolve(process.env.A4_PWA_EVIDENCE_DIR || "a4-pwa-readback-evidence");
const report = {
  status: "running",
  mission_id: MISSION_ID,
  auth: null,
  mission_readback: null,
  notification_readback: null,
  read_only: true,
  failure: null,
};

function persist() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "a4-pwa-readback-report.json"), JSON.stringify(report, null, 2));
}
function fail(reason) {
  report.failure = reason;
  report.status = "FAIL";
  persist();
  throw new Error(reason);
}
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; }
  catch { body = { raw: raw.slice(0, 1000) }; }
  return { response, body };
}
async function loadPublishableKey() {
  const url = "https://api.supabase.com/v1/projects/" + encodeURIComponent(PROJECT) + "/api-keys?reveal=true";
  const { response, body } = await jsonRequest(url, {
    headers: { Authorization: "Bearer " + ACCESS_TOKEN, Accept: "application/json" },
  });
  if (!response.ok || !Array.isArray(body)) fail("supabase_management_api_key_lookup_failed_http_" + response.status);
  const matches = body.filter((entry) =>
    typeof entry?.api_key === "string" &&
    entry.api_key.length > 10 &&
    (String(entry.type || "").toLowerCase() === "publishable" || String(entry.name || "").toLowerCase() === "anon")
  );
  if (!matches.length) fail("publishable_or_anon_key_not_found");
  return matches[0].api_key;
}

async function main() {
  if (PROJECT !== "icuqsstxfdbvjytkhlog") fail("unexpected_supabase_project");
  if (!ACCESS_TOKEN || !EMAIL || !PASSWORD) fail("required_read_only_pwa_credentials_missing");

  const apiKey = await loadPublishableKey();
  const login = await jsonRequest("https://" + PROJECT + ".supabase.co/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const userId = String(login.body?.user?.id || "");
  const accessToken = String(login.body?.access_token || "");
  report.auth = {
    http_status: login.response.status,
    authenticated: login.response.ok && Boolean(accessToken),
    owner_match: userId === EXPECTED_USER_ID,
    user_id: userId || null,
  };
  if (!login.response.ok || !accessToken) fail("rwht_password_login_failed_http_" + login.response.status);
  if (userId !== EXPECTED_USER_ID) fail("rwht_authenticated_user_does_not_own_a4_mission");

  const headers = { Authorization: "Bearer " + accessToken, Accept: "application/json" };
  const mission = await jsonRequest(MISSION_API, { headers });
  const missionValue = mission.body?.mission || mission.body?.data?.mission || mission.body?.data || mission.body;
  report.mission_readback = {
    http_status: mission.response.status,
    mission_status: missionValue?.status || null,
    current_step: missionValue?.current_step ?? null,
    completed_steps: missionValue?.completed_steps ?? null,
    total_steps: missionValue?.total_steps ?? null,
    owner_match: userId === EXPECTED_USER_ID,
    visible: mission.response.ok && missionValue?.status === "succeeded" &&
      Number(missionValue?.completed_steps) === 1 && Number(missionValue?.total_steps) === 1,
  };
  if (!report.mission_readback.visible) fail("authenticated_pwa_mission_readback_failed_http_" + mission.response.status);

  const notifications = await jsonRequest(NOTIFICATIONS_API, { headers });
  const body = notifications.body;
  const entries = Array.isArray(body) ? body
    : Array.isArray(body?.notifications) ? body.notifications
    : Array.isArray(body?.items) ? body.items
    : Array.isArray(body?.data?.notifications) ? body.data.notifications
    : Array.isArray(body?.data?.items) ? body.data.items
    : [];
  const match = entries.find((item) =>
    item?.kind === "mission_completed_verified" &&
    (item?.mission_id === MISSION_ID || item?.metadata?.mission_id === MISSION_ID ||
      item?.metadata?.mission_label?.includes("Mission Wonder 2"))
  ) || null;
  report.notification_readback = {
    http_status: notifications.response.status,
    fetched_count: entries.length,
    kind: match?.kind || null,
    title: match?.title || null,
    mission_match: Boolean(match),
    visible: notifications.response.ok && Boolean(match),
  };
  if (!report.notification_readback.visible) fail("verified_completion_notification_not_visible_in_authenticated_pwa_http_" + notifications.response.status);

  report.status = "PASS";
  report.read_only = true;
  persist();
  console.log("A4_AUTHENTICATED_PWA_MISSION_AND_NOTIFICATION_READBACK_PASS");
}
main().catch((error) => {
  if (!report.failure) report.failure = error instanceof Error ? error.message : String(error);
  report.status = "FAIL";
  persist();
  console.error("A4_PWA_READBACK_FAILED: " + report.failure);
  process.exitCode = 1;
});
