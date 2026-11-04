#!/usr/bin/env python3
import hashlib, hmac, json, os
bridge = os.environ["ARIA_PLAN_PRODUCER_SHARED_SECRET"]
payload = {
    "ARIA_CONTROL_TOKEN": os.environ["ARIA_CONTROL_TOKEN"],
    "ARIA_WORKER_TOKEN": os.environ["ARIA_WORKER_TOKEN"],
    "ARIA_PLAN_PRODUCER_TOKEN": hmac.new(bridge.encode(), b"aria-cloudflare-plan-producer:v1", hashlib.sha256).hexdigest(),
}
for key in ("ARIA_NOTIFICATION_WEBHOOK_URL", "ARIA_NOTIFICATION_TOKEN"):
    if os.environ.get(key):
        payload[key] = os.environ[key]
with open(".aria-autonomy-secrets.json", "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
