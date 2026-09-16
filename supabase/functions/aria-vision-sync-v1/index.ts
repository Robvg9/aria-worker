import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const equal = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); if (x.length !== y.length) return false; let d = 0; for (let i=0;i<x.length;i++) d |= x[i]^y[i]; return d===0; };
async function authorized(req: Request) { const h=req.headers.get("authorization")??""; const t=h.startsWith("Bearer ")?h.slice(7):""; return Boolean(t && SECRET && equal(t,SECRET)); }
function clean(v: unknown, max: number) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
async function hash(text: string) { const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)); return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(''); }

Deno.serve(async req => {
  if (req.method !== 'POST') return out({ error:'method_not_allowed' },405);
  if (!(await authorized(req))) return out({ error:'unauthorized' },401);
  const body = await req.json().catch(()=>({}));
  const visionId=clean(body.vision_id,120) || 'aria-master-vision-v1';
  const sourceRef=clean(body.source_ref,200);
  const sourceUpdatedAt=clean(body.source_updated_at,80) || null;
  const sourceVersion=clean(body.source_version,120) || null;
  const sourceContent=typeof body.source_content==='string'?body.source_content:'';
  const objectives=Array.isArray(body.objectives)?body.objectives:[];
  if (!sourceRef) return out({error:'source_ref_required'},400);
  if (objectives.length>100) return out({error:'too_many_objectives'},400);
  const contentHash=clean(body.content_hash,64) || (sourceContent ? await hash(sourceContent) : null);
  const { error: me } = await sb.schema('aria_internal').from('vision_manifest').upsert({ vision_id:visionId, source_type:'notion', source_ref:sourceRef, source_updated_at:sourceUpdatedAt, source_version:sourceVersion, content_hash:contentHash, snapshot_metadata:{ compiler_status:'live', sync:'notion_to_vision_manifest', received_at:new Date().toISOString(), objective_count:objectives.length }, active:true, updated_at:new Date().toISOString() }, { onConflict:'vision_id' });
  if (me) return out({error:'manifest_upsert_failed',detail:me.message},500);
  let synced=0;
  for (const item of objectives) {
    const objectiveId=clean(item.objective_id,160); const objective=clean(item.objective,2000); if (!objectiveId||!objective) continue;
    const metadata=item.metadata && typeof item.metadata==='object' && !Array.isArray(item.metadata) ? item.metadata : {};
    const verifier=item.verifier && typeof item.verifier==='object' && !Array.isArray(item.verifier) ? item.verifier : { type:'evidence_required', success_conditions:['reproducible_evidence'] };
    const dependencies=Array.isArray(item.dependencies)?item.dependencies.filter((x:any)=>typeof x==='string').slice(0,20):[];
    const { error } = await sb.schema('aria_internal').from('vision_objectives').upsert({ objective_id:objectiveId, vision_id:visionId, objective, priority:Number.isFinite(Number(item.priority))?Math.max(0,Math.min(100,Number(item.priority))):50, status:['queued','paused','blocked','completed','archived'].includes(String(item.status))?String(item.status):'queued', source_section:clean(item.source_section,500)||null, acceptance:clean(item.acceptance,2000)||null, verifier, dependencies, content_hash:contentHash, metadata:{...metadata, synced_from:'notion', source_ref:sourceRef, source_version:sourceVersion, synced_at:new Date().toISOString()}, updated_at:new Date().toISOString() }, { onConflict:'objective_id' });
    if (error) return out({error:'objective_upsert_failed',objective_id:objectiveId,detail:error.message},500);
    synced++;
  }
  const { data: compiled, error: ce } = await sb.rpc('aria_internal.compile_all_active_vision_objectives');
  if (ce) return out({error:'compile_failed',detail:ce.message},500);
  return out({ok:true,vision_id:visionId,source_ref:sourceRef,content_hash:contentHash,objectives_received:objectives.length,objectives_synced:synced,goals_compiled:Number(compiled||0),compiler:'vision-objective-compiler-v1',sync:'notion_to_manifest_to_goals'});
});
