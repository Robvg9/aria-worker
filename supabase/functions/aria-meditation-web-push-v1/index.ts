import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aria-webpush-secret",
  "access-control-allow-methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });

function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_not_configured");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false },
  });
}

function compactError(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 600 ? text.slice(0, 600) : text;
}

function toSubscription(row: any) {
  return {
    endpoint: String(row.endpoint),
    expirationTime: row.expiration_time == null ? null : Number(row.expiration_time),
    keys: {
      p256dh: String(row.p256dh),
      auth: String(row.auth),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = serviceClient();
  try {
    const { data: cfg, error: cfgError } = await sb.rpc("aria_get_web_push_runtime_config");
    if (cfgError) return json({ error: "webpush_runtime_config_failed", detail: cfgError.message }, 500);

    const expectedSecret = String(cfg?.webhook_secret ?? "");
    const providedSecret = String(req.headers.get("x-aria-webpush-secret") ?? "");
    if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
      return json({ error: "unauthorized_webhook" }, 401);
    }

    const body = await req.json().catch(() => null);
    const n = body?.notification;
    const notificationId = String(n?.notification_id ?? "").trim();
    const missionId = String(n?.mission_id ?? "").trim();
    if (!notificationId || !missionId) return json({ error: "notification_identity_required" }, 400);

    const { data: mission, error: missionError } = await sb
      .schema("aria_internal")
      .from("mission_state")
      .select("metadata")
      .eq("mission_id", missionId)
      .maybeSingle();
    if (missionError) return json({ error: "mission_owner_lookup_failed", detail: missionError.message }, 502);

    const metadata = mission?.metadata && typeof mission.metadata === "object" ? mission.metadata : {};
    const userId = String(metadata.user_id ?? metadata.owner_user_id ?? "").trim();
    if (!userId) return json({ error: "mission_owner_missing" }, 422);

    const { data: subscriptions, error: subError } = await sb
      .schema("aria_internal")
      .from("meditation_push_subscriptions")
      .select("subscription_id,endpoint,p256dh,auth,expiration_time")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(20);
    if (subError) return json({ error: "push_subscription_lookup_failed", detail: subError.message }, 502);

    const rows = Array.isArray(subscriptions) ? subscriptions : [];
    if (!rows.length) {
      return json({ ok: true, delivered: 0, skipped: 0, reason: "no_active_subscription", notification_id: notificationId });
    }

    const vapidPublic = String(cfg?.vapid_public ?? "");
    const vapidPrivate = String(cfg?.vapid_private ?? "");
    if (!vapidPublic || !vapidPrivate) return json({ error: "vapid_config_missing" }, 500);
    webpush.setVapidDetails("https://aria.robvg9.workers.dev/", vapidPublic, vapidPrivate);

    let delivered = 0;
    let skipped = 0;
    let failed = 0;
    let expired = 0;

    const payload = JSON.stringify({
      notification_id: notificationId,
      mission_id: missionId,
      kind: String(n?.kind ?? "update"),
      severity: String(n?.severity ?? "info"),
      title: String(n?.title ?? "Actualización de ARIA"),
      body: String(n?.message ?? "ARIA tiene una actualización."),
      action: String(n?.action ?? "review_result"),
      url: "/pwa/#notification=" + encodeURIComponent(notificationId),
      created_at: n?.created_at ?? new Date().toISOString(),
    });

    for (const row of rows) {
      const subscriptionId = String(row.subscription_id);
      const { data: prior, error: priorError } = await sb
        .schema("aria_internal")
        .from("meditation_push_deliveries")
        .select("status")
        .eq("notification_id", notificationId)
        .eq("subscription_id", subscriptionId)
        .maybeSingle();
      if (priorError) return json({ error: "push_delivery_lookup_failed", detail: priorError.message }, 502);
      if (String(prior?.status ?? "") === "sent") {
        skipped++;
        continue;
      }

      const attempt = Number((prior as any)?.attempts ?? 0) + 1;
      await sb.schema("aria_internal").from("meditation_push_deliveries").upsert({
        notification_id: notificationId,
        subscription_id: subscriptionId,
        status: "pending",
        attempts: attempt,
        error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "notification_id,subscription_id" });

      try {
        await webpush.sendNotification(toSubscription(row), payload, { TTL: 300 });
        const { error: deliveredError } = await sb.schema("aria_internal").from("meditation_push_deliveries").upsert({
          notification_id: notificationId,
          subscription_id: subscriptionId,
          status: "sent",
          http_status: 201,
          attempts: attempt,
          error: null,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "notification_id,subscription_id" });
        if (deliveredError) return json({ error: "push_delivery_persist_failed", detail: deliveredError.message }, 502);
        delivered++;
      } catch (error) {
        const statusCode = Number((error as any)?.statusCode ?? 0);
        const errorText = compactError((error as any)?.body ?? error);
        const isExpired = statusCode === 404 || statusCode === 410;
        if (isExpired) {
          await sb.schema("aria_internal").from("meditation_push_subscriptions").update({
            active: false,
            updated_at: new Date().toISOString(),
          }).eq("subscription_id", subscriptionId);
          expired++;
        }
        await sb.schema("aria_internal").from("meditation_push_deliveries").upsert({
          notification_id: notificationId,
          subscription_id: subscriptionId,
          status: isExpired ? "expired" : "failed",
          http_status: statusCode || null,
          attempts: attempt,
          error: errorText,
          updated_at: new Date().toISOString(),
        }, { onConflict: "notification_id,subscription_id" });
        failed++;
      }
    }

    return json({
      ok: true,
      notification_id: notificationId,
      mission_id: missionId,
      user_id: userId,
      subscriptions: rows.length,
      delivered,
      skipped,
      failed,
      expired,
    });
  } catch (error) {
    return json({ error: "internal_error", detail: compactError(error) }, 500);
  }
});
