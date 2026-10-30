const MISSION_EXECUTION_PAUSED = true;
const CORS_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "authorization,apikey,content-type,x-aria-autonomy-token"
};
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}
Deno.serve((request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (MISSION_EXECUTION_PAUSED) {
    return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
  }
  return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
});
