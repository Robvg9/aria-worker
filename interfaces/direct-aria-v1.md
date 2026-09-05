# Direct ARIA Interface v1

## Contract

`Robert -> authenticated ARIA interface -> canonical mission intake -> canonical runtime -> mission state -> cognitive memory/reflection/learning`

### GET /aria
Returns interface metadata and health. This endpoint never executes a mission.

### POST /aria
Authenticated with the canonical ARIA runtime shared secret.

Request:
```json
{
  "goal": "string",
  "mission_id": "optional string",
  "metadata": "optional object"
}
```

The interface accepts only an objective; planning, executor selection, governance, execution, verification, recovery and learning remain owned by the canonical runtime.

The interface MUST NOT contain provider/model selection logic, direct database writes, direct executor calls, alternate memory writers or a second mission state machine.
