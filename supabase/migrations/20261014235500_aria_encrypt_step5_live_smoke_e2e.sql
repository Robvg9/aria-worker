-- One-time ARIA Encrypt Step 5 live smoke E2E.
-- Creates only random synthetic fixtures, asserts fail-closed and general-only behavior,
-- and deletes every successful fixture before this migration commits.

BEGIN;

DO $encrypt_step5_e2e$
DECLARE
  marker text := 'encryptrouteclosureprobe' || replace(gen_random_uuid()::text, '-', '');
  v_memory_id uuid;
  v_learning_id uuid;
  v_document_id uuid;
  v_chunk_id uuid;
  v_candidate_id uuid;
  v_event_id uuid;
  denied boolean;
  found_count integer;
  v_redacted_query text;
BEGIN
  -- Canonical memory: unclassified insert must be rejected.
  denied := false;
  BEGIN
    INSERT INTO aria_memory.memory_items
      (memory_type,title,content,content_hash,source_type,metadata)
    VALUES
      ('lesson',marker,marker || ' synthetic unclassified fixture',marker || 'unclassifiedhash',
       'system','{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: unclassified canonical memory insert was accepted'; END IF;

  -- Explicitly general synthetic memory must insert and pass each live reader.
  INSERT INTO aria_memory.memory_items
    (memory_type,title,content,content_hash,source_type,metadata,confidence,importance,salience)
  VALUES
    ('lesson',marker,marker || ' synthetic general lesson',marker || 'generalhash',
     'system',jsonb_build_object('privacy_class','general','scope','encrypt_e2e_synthetic'),
     0.99,0.9,0.9)
  RETURNING memory_id INTO v_memory_id;

  SELECT count(*) INTO found_count
    FROM aria_memory.search_lexical(marker,20) AS s WHERE s.memory_id=v_memory_id;
  IF found_count <> 1 THEN RAISE EXCEPTION 'E2E_FAIL: lexical search did not return general synthetic row'; END IF;

  SELECT count(*) INTO found_count
    FROM public.aria_memory_search_hybrid_text(marker,NULL,20,0.55,0.45,50) AS s
   WHERE s.memory_id=v_memory_id;
  IF found_count <> 1 THEN RAISE EXCEPTION 'E2E_FAIL: public hybrid wrapper did not return general synthetic row'; END IF;

  SELECT count(*) INTO found_count
    FROM public.aria_memory_learning_context_for_goal(marker,50) AS s
   WHERE s.memory_id=v_memory_id;
  IF found_count <> 1 THEN RAISE EXCEPTION 'E2E_FAIL: learning context wrapper did not return general synthetic row'; END IF;

  -- Internal learning records: default/unclassified rows must be rejected.
  denied := false;
  BEGIN
    INSERT INTO aria_internal.autonomy_learnings
      (mission_id,goal_id,category,summary,evidence,confidence,reusable)
    VALUES
      ('e2e:' || marker,marker,'verified_procedure',marker || ' unclassified fixture',
       jsonb_build_object('synthetic',true),0.9,true);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: unclassified learning insert was accepted'; END IF;

  INSERT INTO aria_internal.autonomy_learnings
    (mission_id,goal_id,category,summary,evidence,confidence,reusable,privacy_class)
  VALUES
    ('e2e:' || marker,marker,'verified_procedure',marker || ' general synthetic learning',
     jsonb_build_object('synthetic',true),0.9,true,'general')
  RETURNING lesson_id INTO v_learning_id;
  SELECT count(*) INTO found_count FROM aria_internal.autonomy_learnings
   WHERE lesson_id=v_learning_id AND privacy_class='general';
  IF found_count <> 1 THEN RAISE EXCEPTION 'E2E_FAIL: explicitly general learning was not readable internally'; END IF;

  -- Shared retrieval index: unclassified docs/candidates must be rejected.
  denied := false;
  BEGIN
    INSERT INTO public.cb_documents(source_type,source_id,title,metadata)
    VALUES ('aria_encrypt_e2e','deny:' || marker,marker || ' unclassified doc','{}'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: unclassified shared document insert was accepted'; END IF;

  INSERT INTO public.cb_documents(source_type,source_id,title,status,authority,metadata)
  VALUES ('aria_encrypt_e2e',marker,marker || ' general synthetic doc','vigente','documentacion',
          jsonb_build_object('privacy_class','general','synthetic_e2e',true))
  RETURNING id INTO v_document_id;

  INSERT INTO public.cb_chunks(document_id,chunk_index,heading,content,metadata,content_hash)
  VALUES (v_document_id,0,marker,marker || ' synthetic general chunk',
          jsonb_build_object('privacy_class','general','synthetic_e2e',true),marker || 'chunkhash')
  RETURNING id INTO v_chunk_id;

  SELECT count(*) INTO found_count FROM public.cb_search_chunks(marker,10) AS s
   WHERE s.chunk_id=v_chunk_id AND s.document_id=v_document_id;
  IF found_count <> 1 THEN RAISE EXCEPTION 'E2E_FAIL: shared search wrapper did not return general synthetic chunk'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.cb_memory_candidates
      (candidate_text,kind,epistemic_proposed,content_hash,privacy_class)
    VALUES (marker || ' unclassified candidate','synthetic_e2e','test',marker || 'candidate-deny','unclassified');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: unclassified memory candidate insert was accepted'; END IF;

  INSERT INTO public.cb_memory_candidates
    (candidate_text,kind,epistemic_proposed,content_hash,privacy_class,provenance)
  VALUES (marker || ' general synthetic candidate','synthetic_e2e','test',marker || 'candidate-general',
          'general',jsonb_build_object('synthetic_e2e',true))
  RETURNING id INTO v_candidate_id;

  -- Retrieval audit must never retain the raw query string.
  v_event_id := public.cb_record_retrieval(marker,'{}'::uuid[],'synthetic_e2e',
    jsonb_build_object('source','encrypt_e2e','transport','sql'));
  SELECT query INTO v_redacted_query FROM public.cb_retrieval_events WHERE id=v_event_id;
  IF v_redacted_query IS DISTINCT FROM '[REDACTED: query content not retained]' THEN
    RAISE EXCEPTION 'E2E_FAIL: retrieval audit did not redact raw query';
  END IF;

  -- Verify least-privilege grants on both client roles.
  IF has_function_privilege('anon','public.cb_search_chunks(text,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.cb_search_chunks(text,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.cb_search_chunks(text,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'E2E_FAIL: legacy chunk-search RPC grants are inconsistent';
  END IF;

  -- Cleanup all successful synthetic writes before committing this proof migration.
  DELETE FROM public.cb_retrieval_events WHERE id=v_event_id;
  DELETE FROM public.cb_memory_candidates WHERE id=v_candidate_id;
  DELETE FROM public.cb_documents WHERE id=v_document_id; -- cascades synthetic chunk
  DELETE FROM aria_internal.autonomy_learnings WHERE lesson_id=v_learning_id;
  DELETE FROM aria_memory.memory_items WHERE memory_id=v_memory_id;

  IF EXISTS (SELECT 1 FROM aria_memory.memory_items WHERE content_hash=marker || 'generalhash')
     OR EXISTS (SELECT 1 FROM aria_internal.autonomy_learnings WHERE mission_id='e2e:' || marker)
     OR EXISTS (SELECT 1 FROM public.cb_documents WHERE source_id=marker)
     OR EXISTS (SELECT 1 FROM public.cb_memory_candidates WHERE content_hash=marker || 'candidate-general')
     OR EXISTS (SELECT 1 FROM public.cb_retrieval_events WHERE id=v_event_id) THEN
    RAISE EXCEPTION 'E2E_FAIL: synthetic fixture cleanup left rows behind';
  END IF;
END
$encrypt_step5_e2e$;

COMMIT;
