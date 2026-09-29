-- Hot-path index for Human Gate telemetry queries used by PWA operational surfaces.
create index if not exists mission_events_type_created_idx
  on aria_internal.mission_events (event_type, created_at desc);
