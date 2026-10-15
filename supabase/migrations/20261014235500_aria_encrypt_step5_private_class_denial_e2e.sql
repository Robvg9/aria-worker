-- ARIA Encrypt Step 5: explicit private-class rejection E2E.
-- The tests run in a single migration transaction and create no lasting private data.

BEGIN;

DO $private_class_denial_e2e$
DECLARE
  marker text := 'ariaencryptprivatedeny' || replace(gen_random_uuid()::text,'-','');
  v_document_id uuid;
  denied boolean;
BEGIN
  -- Canonical memory: private is not an accepted write class.
  denied := false;
  BEGIN
    INSERT INTO aria_memory.memory_items
      (memory_type,title,content,content_hash,source_type,metadata)
    VALUES
      ('lesson',marker,marker || ' private synthetic denial fixture',
       marker || 'memoryhash','system',jsonb_build_object('privacy_class','private'));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: private canonical-memory insert was accepted'; END IF;

  -- Internal learning table: private rows are blocked by the same explicit-general trigger.
  denied := false;
  BEGIN
    INSERT INTO aria_internal.autonomy_learnings
      (mission_id,goal_id,category,summary,evidence,confidence,reusable,privacy_class)
    VALUES
      ('e2e:' || marker,marker,'verified_procedure',marker || ' private learning fixture',
       jsonb_build_object('synthetic',true),0.9,true,'private');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: private learning insert was accepted'; END IF;

  -- Shared document: private content is blocked before it can enter the retrieval index.
  denied := false;
  BEGIN
    INSERT INTO public.cb_documents(source_type,source_id,title,metadata)
    VALUES ('aria_encrypt_e2e',marker,marker || ' private document',jsonb_build_object('privacy_class','private'));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: private shared-document insert was accepted'; END IF;

  -- Shared chunk: even a general parent cannot accept a private/unclassified chunk.
  INSERT INTO public.cb_documents(source_type,source_id,title,status,authority,metadata)
  VALUES ('aria_encrypt_e2e',marker || ':parent',marker || ' synthetic general parent',
          'vigente','documentacion',jsonb_build_object('privacy_class','general','synthetic_e2e',true))
  RETURNING id INTO v_document_id;

  denied := false;
  BEGIN
    INSERT INTO public.cb_chunks(document_id,chunk_index,heading,content,metadata,content_hash)
    VALUES (v_document_id,0,marker,marker || ' private synthetic chunk',
            jsonb_build_object('privacy_class','private','synthetic_e2e',true),marker || 'chunkhash');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: private shared-chunk insert was accepted'; END IF;

  -- Candidate staging: private candidates are rejected, not silently queued.
  denied := false;
  BEGIN
    INSERT INTO public.cb_memory_candidates
      (candidate_text,kind,epistemic_proposed,content_hash,privacy_class,provenance)
    VALUES (marker || ' private candidate','synthetic_e2e','test',marker || 'candidatehash',
            'private',jsonb_build_object('synthetic_e2e',true));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'E2E_FAIL: private memory candidate was accepted'; END IF;

  DELETE FROM public.cb_documents WHERE id=v_document_id;
  IF EXISTS (SELECT 1 FROM public.cb_documents WHERE source_id=marker OR source_id=marker || ':parent')
     OR EXISTS (SELECT 1 FROM aria_memory.memory_items WHERE content_hash=marker || 'memoryhash')
     OR EXISTS (SELECT 1 FROM aria_internal.autonomy_learnings WHERE mission_id='e2e:' || marker)
     OR EXISTS (SELECT 1 FROM public.cb_memory_candidates WHERE content_hash=marker || 'candidatehash')
     OR EXISTS (SELECT 1 FROM public.cb_chunks WHERE content_hash=marker || 'chunkhash') THEN
    RAISE EXCEPTION 'E2E_FAIL: private-class denial fixtures left rows behind';
  END IF;
END
$private_class_denial_e2e$;

COMMIT;
