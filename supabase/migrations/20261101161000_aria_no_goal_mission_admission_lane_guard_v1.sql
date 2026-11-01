-- Require an explicit execution lane for standalone missions.
-- This migration changes a function only; it does not alter existing rows.
-- Both canonical next-lease and claim-by-id paths call this eligibility function.
-- Explicit test/human_gate lanes remain available to their separately gated workers;
-- unclassified no-goal missions fail closed.
CREATE OR REPLACE FUNCTION aria_internal.aria_mission_claim_eligible(p_mission_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
select exists (
  select 1
    from aria_internal.mission_state m
    left join aria_internal.autonomy_goals g
      on g.goal_id=coalesce(m.metadata->>'goal_id','')
    left join aria_internal.vision_objectives v
      on v.objective_id=coalesce(g.metadata->>'vision_objective_id','')
   where m.mission_id=p_mission_id
     and m.status in ('queued','failed','paused','planning','running','waiting')
     and coalesce(m.checkpoint->'recovery'->>'status','') not in (
       'waiting_for_human_gate','human_gate_pending','retry_exhausted'
     )
     and (
       m.status <> 'waiting'
       or coalesce(m.checkpoint->'recovery'->>'status','') in ('verification_pending','waiting_for_alternative_strategy')
     )
     and not (
       m.status='failed'
       and coalesce(m.last_recovery_reason,'')='failed_mission_replanned'
       and coalesce(m.recovery_count,0)>=3
       and coalesce(m.checkpoint->'recovery'->>'failure_reason','')='coordinator_test_evidence_missing'
     )
     -- Standalone missions need explicit lane provenance. A source label alone is
     -- not enough: the legacy BattleCruiser read-only batch had no goal and no lane.
     -- Goal-linked missions retain the existing governed dependency/attempt policy.
     and (
       g.goal_id is not null
       or nullif(btrim(coalesce(
         nullif(m.metadata->>'execution_lane',''),
         nullif(m.metadata->>'goal_source','')
       )), '') is not null
     )
     and (
       g.goal_id is null
       or (
         -- A human-governed explicit max_attempts increase is required to reopen
         -- an exhausted goal. Ordinary queue/supervisor retries cannot bypass it.
         coalesce(g.attempts,0) < coalesce(g.max_attempts,3)
         and coalesce(g.objective_verification_status,'UNVERIFIED')<>'DUPLICATE_HISTORICAL'
         and coalesce(g.status,'')<>'completed'
         and (g.last_mission_id is null or g.last_mission_id=m.mission_id)
         and (
           coalesce(g.status,'')<>'blocked'
           or (
             g.last_mission_id=m.mission_id
             and (
               coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
               or coalesce(m.metadata->>'replan_required','')='true'
               or coalesce(m.metadata->>'resume_blocked_goal','')='true'
             )
           )
         )
         and (
           v.objective_id is null
           or v.status<>'completed'
           or coalesce(m.checkpoint->'recovery'->>'replan_required','')='true'
           or coalesce(m.metadata->>'replan_required','')='true'
           or coalesce(m.metadata->>'resume_blocked_goal','')='true'
         )
         and (
           jsonb_array_length(coalesce(g.metadata->'dependencies','[]'::jsonb))=0
           or not exists (
             select 1
               from jsonb_array_elements_text(coalesce(g.metadata->'dependencies','[]'::jsonb)) d(dep_id)
               left join aria_internal.autonomy_goals dep
                 on dep.goal_id=aria_internal.resolve_dependency_goal_id(d.dep_id)
              where dep.goal_id is null
                 or dep.status<>'completed'
                 or dep.objective_verification_status<>'CONFIRMED'
           )
         )
       )
     )
);
$function$;
