'use strict';

const ALLOWED_PATHS = new Set([
  '/functions/v1/aria-planner-v11',
  '/aria-planner-v11'
]);

// Supabase's edge runtime can expose either the gateway path or the stripped
// function-local path to Deno.serve. Accept only those two exact endpoint forms.
export function isCloudflarePlanProducerPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return ALLOWED_PATHS.has(normalized);
}
