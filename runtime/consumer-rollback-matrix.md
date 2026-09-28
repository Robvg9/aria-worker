# ARIA Runtime Canónico — Consumer / Rollback Matrix v1

| Surface | Consumer | Canonical authority | Rollback | Legacy allowed? |
|---|---|---|---|---|
| Scheduler | Cloudflare scheduled | aria-canonical-runtime-v1 | revert canonical entrypoint/workflow | No |
| Autonomy | aria-device-gateway /v1/autonomy/cycle | aria-canonical-runtime-v1 | revert gateway consumer only | No |
| Meditation | aria-device-gateway tick-service | aria-canonical-runtime-v1 | disable bridge, preserve mission state | No |
| Mission tick | aria_internal.run_mission_runner_tick_v1 | aria-mission-runner-v22 | revert SQL consumer/function | No |
| Planning | mission-runner-v22 | aria-planner-v11 | revert planner stage only | No |
| Model execution | mission-runner-v22 | aria-execution-runtime-v1 | reroute within verified route policy | No |
| Device jobs | mission-runner-v22 | aria-runtime-gateway-v1 + device-gateway | recover job lease; do not re-run blind | No |
| Verification | mission-runner-v22 | aria-smart-verifier-v1 | retry verification, never mutate mission outcome | No |

## Legacy boundary

Legacy planner/runner/supervisor functions remain only as compatibility inventory entries.
They are removed from the canonical deployment workflow and must not be called by new consumers.
Existing live legacy versions are not deleted automatically; deactivation requires a separate consumer audit.

## Failure split

`pwa` and `device` are independent failure surfaces. A PWA/API timeout does not become a device-offline diagnosis.
Provider/model/agent/connector/EAS errors remain executor-specific and are not collapsed into a generic runtime failure.