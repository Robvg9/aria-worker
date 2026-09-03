# ARIA Execution Engine — Block 4/9

Controlled orchestration above the existing Execution Engine (10.8).

Missions:
- 4.1 Task execution coordinator
- 4.2 Dependency resolver
- 4.3 Multi-step executor
- 4.4 Execution monitor
- 4.5 Failure recovery
- 4.6 Verification engine
- 4.7 Rollback engine
- 4.8 Long-running/resumable tasks

Safety:
- Existing Router, Permission Resolver, Gateway, Credential Boundary and Governance remain authoritative.
- The coordinator never invents authorization or credentials.
- Rollback is compensation-based and requires explicitly supplied compensators.
- Long-running state is injected through a persistence adapter; no hidden durable state is created.
