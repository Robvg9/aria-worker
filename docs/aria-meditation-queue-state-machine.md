# ARIA Meditation Queue State Machine

## Canonical invariants

- A queue item represents a logical mission, not a single runner batch.
- A non-terminal runner result keeps the queue item resumable (`running` or explicit `paused`), never silently parked.
- One Meditation service tick starts at most one new queue item.
- Continuations are recovered from canonical `mission_state` using the mission's next action and lease state.
- The canonical scheduler uses an explicit timeout compatible with the runner path.
- Execution lanes prevent exploratory idea/test backlog from starving primary objectives.
