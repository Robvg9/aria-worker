# Tool Router 11.2

Design-controlled Control Plane selector between the Tool Registry and Governance.

It selects only registered, available tool operations and produces deterministic plans. It never authorizes, resolves credentials, dispatches tools, mutates quota/capacity, performs fallback, or writes canonical memory.

Multi-tool plans are composed as independently selectable steps; downstream Governance must authorize each material operation/scope.
