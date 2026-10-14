-- Historical applied follow-up: keep shared chunks bound to explicitly reviewed general documents.
-- This migration is already present in Supabase migration history; this file restores source/evidence alignment.

BEGIN;

CREATE OR REPLACE FUNCTION public.aria_encrypt_require_general_chunk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  document_class text;
BEGIN
  SELECT d.metadata->>'privacy_class'
    INTO document_class
    FROM public.cb_documents d
   WHERE d.id = NEW.document_id;
  IF document_class IS DISTINCT FROM 'general' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'parent_document_not_classified_general';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aria_encrypt_general_chunk_guard ON public.cb_chunks;
CREATE TRIGGER aria_encrypt_general_chunk_guard
BEFORE INSERT OR UPDATE OF document_id, heading, content, metadata
ON public.cb_chunks
FOR EACH ROW EXECUTE FUNCTION public.aria_encrypt_require_general_chunk();

COMMIT;
