revoke execute on function aria_internal.aria_mission_resolve_human_gate(text, jsonb) from public, authenticated;
revoke execute on function aria_internal.aria_meditation_approve_human_gate(text, jsonb) from public, authenticated;
comment on function aria_internal.aria_mission_resolve_human_gate(text, jsonb) is
  'Internal Human Gate resolver. External execution is blocked; authenticated app requests must pass through aria-app-api-v3.';
comment on function aria_internal.aria_meditation_approve_human_gate(text, jsonb) is
  'Legacy authenticated Human Gate wrapper retained for compatibility but externally disabled; approvals must pass through aria-app-api-v3.';
