const VERSION = "aria-proactive-intelligence-v1.0.0";
const ACTION_MODE = "recommendation_only";

function canonical(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const stringOrNull=(v)=>typeof v==="string"&&v.trim()?v.trim():null;
const badResource=new Set(["degraded","unavailable","blocked","failed"]);

function rec({kind,priority,title,reason,next_action,source_refs=[],fields={}}){
  const fingerprintPlaceholder={version:VERSION,kind,fields};
  return {kind,priority,title,reason,next_action,source_refs:[...new Set(source_refs.filter(Boolean).map(String))],fingerprint_input:fingerprintPlaceholder};
}

async function finalizeRecommendation(item){
  const fingerprint=(await sha256(item.fingerprint_input)).slice(0,24);
  return Object.freeze({...item,id:"proactive_"+fingerprint,version:VERSION,action_mode:ACTION_MODE,fingerprint});
}

async function analyze(snapshot){
  const recommendations=[];
  const queued=Number(snapshot.queue?.queued_jobs)||0;
  const eligible=snapshot.queue?.eligible_online_executors;
  const online=snapshot.queue?.online_executors;
  if(queued>0 && ((eligible===null&&online===null)||(eligible===0)||(eligible===null&&online===0))){
    if(eligible===null&&online===null) recommendations.push(rec({
      kind:"queue_state_unknown",priority:"normal",
      title:"No hay evidencia suficiente sobre los executors de la cola",
      reason:`${queued} trabajo(s) están encolados, pero no existe una medición válida de executors elegibles u online.`,
      next_action:"Obtener un snapshot actual de los executors antes de concluir que la cola está bloqueada o disponible.",
      source_refs:[snapshot.queue?.evidence_ref],
      fields:{queued_jobs:queued,eligible_online_executors:null,online_executors:null}
    }));
    else recommendations.push(rec({
      kind:"queue_blocked",priority:"high",
      title:"Hay trabajo en cola sin executor elegible",
      reason:`${queued} trabajo(s) están encolados y no hay evidencia de un executor online elegible.`,
      next_action:"Identificar un executor realmente disponible o dejar la cola en espera; no asumir disponibilidad.",
      source_refs:[snapshot.queue?.evidence_ref],
      fields:{queued_jobs:queued,eligible_online_executors:eligible,online_executors:online}
    }));
  }

  for(const r of Array.isArray(snapshot.resources)?snapshot.resources:[]){
    const id=stringOrNull(r.id||r.resource_id||r.model_id||r.provider_id);
    const status=stringOrNull(r.status)?.toLowerCase()||"unknown";
    if(!id || !badResource.has(status)) continue;
    recommendations.push(rec({
      kind:"resource_degraded",
      priority:status==="failed"||status==="blocked"?"high":"normal",
      title:"Revisar recurso degradado o no disponible",
      reason:`El recurso ${id} está observado como ${status}; no debe tratarse como disponible.`,
      next_action:"Obtener evidencia nueva del recurso antes de considerarlo apto para selección.",
      source_refs:[id,r.evidence_ref,r.source_ref],
      fields:{resource_id:id,status,live_verified:r.live_verified===true}
    }));
  }

  for(const d of Array.isArray(snapshot.diagnostics)?snapshot.diagnostics:[]){
    const id=stringOrNull(d.id||d.diagnostic_id);
    const severity=stringOrNull(d.severity)?.toLowerCase()||"info";
    const status=stringOrNull(d.status)?.toLowerCase()||"unknown";
    if(!id || !["critical","error"].includes(severity) || !badResource.has(status)) continue;
    recommendations.push(rec({
      kind:"diagnostic_attention",
      priority:severity==="critical"?"urgent":"high",
      title:"Existe un diagnóstico operativo sin resolver",
      reason:`El diagnóstico ${id} está marcado como ${severity}/${status}.`,
      next_action:"Revisar la causa raíz y la evidencia asociada antes de realizar acciones correctivas.",
      source_refs:[id,d.correlation_id],
      fields:{diagnostic_id:id,severity,status}
    }));
  }

  const out=[];
  const seen=new Set();
  for(const item of recommendations){
    const final=await finalizeRecommendation(item);
    if(seen.has(final.fingerprint)) continue;
    seen.add(final.fingerprint);
    out.push(final);
  }
  const order={urgent:0,high:1,normal:2,low:3};
  out.sort((a,b)=>order[a.priority]-order[b.priority]||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
  return {
    version:VERSION,action_mode:ACTION_MODE,status:out.length?"attention":"quiet",
    recommendation_count:out.length,
    urgent_count:out.filter(x=>x.priority==="urgent").length,
    high_count:out.filter(x=>x.priority==="high").length,
    normal_count:out.filter(x=>x.priority==="normal").length,
    low_count:out.filter(x=>x.priority==="low").length,
    fingerprints:out.map(x=>x.fingerprint),
    recommendations:out.map(({fingerprint_input,...x})=>Object.freeze(x))
  };
}
export {VERSION,ACTION_MODE,canonical,sha256,analyze};
