-- Security hardening: internal forensic/audit tables must not be exposed without an explicit policy model.
alter table aria_internal.forensic_audit_campaigns_v1 enable row level security;
alter table aria_internal.goal_audit_snapshots_v1 enable row level security;
alter table aria_internal.objective_closure_audit_v1 enable row level security;
alter table aria_internal.objective_verification_runs_v1 enable row level security;
