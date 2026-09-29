-- Projects mission listing hot-path index.
-- The index is intentionally idempotent because the same definition was applied during
-- live incident mitigation before the migration was committed to source control.
create index if not exists mission_state_project_updated_idx
  on aria_internal.mission_state ((metadata ->> 'project_id'), updated_at desc);
