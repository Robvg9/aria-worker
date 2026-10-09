import { analyzeMissionConsistency } from './mission-consistency.mjs';
export const registry = {"version":"aria-operational-diagnostics-v1.0.0","status_categories":["healthy","degraded","failed","blocked","unavailable","unknown"],"severity":["info","warning","error","critical"],"categories":["pwa","device","runtime","provider","model","connector","agent","eas","auth","credential","lease","timeout","backpressure","verifier","policy","routing","unknown"],"required_diagnosis":["root_cause","summary","explanation","expected","observed","dependency","next_action"]};
const SECRET_PATTERNS=[/Bearer\s+[A-Za-z0-9._\-]+/gi,/\bsk-[A-Za-z0-9_\-]{8,}/g,/\bor-v1-[A-Za-z0-9_\-]{8,}/g,/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi];
function sanitizeText(value,max=600){let out=value==null?'':String(value);for(const re of SECRET_PATTERNS)out=out.replace(re,'[REDACTED]');return out.slice(0,max);}
function cleanId(value){return typeof value==='string'&&value.trim()?value.trim():null;}
function payloadOf(event){return event&&event.payload&&typeof event.payload==='object'?event.payload:{};}
function firstString(...values){for(const value of values){const v=cleanId(value);if(v)return v;}return null;}
function safeErrorCode(...values){return sanitizeText(firstString(...values),240)||null;}
function classifyDiagnostic(input={}){
 const status=String(input.status||'unknown').toLowerCase();
 const raw=[input.event_type,input.error_code,input.message,input.recovery_status,input.executor_type,input.operation].map(v=>String(v||'').toLowerCase()).join(' ');
 let category='unknown',root_cause=sanitizeText(input.error_code||input.event_type||'unknown_diagnostic',240),severity='info';
 if(/timeout|watchdog|timed_out|deadline/.test(raw)){category='timeout';root_cause=sanitizeText(input.error_code||'execution_timeout',240);}
 else if(/backpressure|queue_full|max_global|max_device|saturated|capacity_exhausted/.test(raw)){category='backpressure';root_cause=sanitizeText(input.error_code||'backpressure',240);}
 else if(/duplicate[_ -]?job|idempoten|dedup|already[_ -]?enqueued/.test(raw)){category='lease';root_cause=sanitizeText(input.error_code||'duplicate_job',240);}
 else if(/lease|reclaim|fence|owner/.test(raw)){category='lease';root_cause=sanitizeText(input.error_code||'lease_conflict',240);}
 else if(/credential|token|api[_-]?key|secret/.test(raw)){category='credential';root_cause=sanitizeText(input.error_code||'credential_unavailable',240);}
 else if(/human_gate|approval|authorize|permission|authorization|policy/.test(raw)){category=/human_gate|approval|authorize|permission|authorization/.test(raw)?'auth':'policy';root_cause=sanitizeText(input.error_code||(category==='auth'?'authorization_required':'policy_block'),240);}
 else if(/verif|verification|evidence_missing|insufficient_evidence/.test(raw)){category='verifier';root_cause=sanitizeText(input.error_code||'verification_evidence_missing',240);}
 else if(/device|windows|android|termux|offline|computer.use/.test(raw)||String(input.executor_type||'').toLowerCase()==='device'){category='device';root_cause=sanitizeText(input.error_code||'device_execution_failure',240);}
 else if(/openrouter|google|gemini|xai|provider|upstream/.test(raw)){category='provider';root_cause=sanitizeText(input.error_code||'provider_error',240);}
 else if(/model|capability/.test(raw)||String(input.executor_type||'').toLowerCase()==='model'){category='model';root_cause=sanitizeText(input.error_code||'model_unavailable',240);}
 else if(/connector|github|supabase|http_json/.test(raw)||String(input.executor_type||'').toLowerCase()==='connector'){category='connector';root_cause=sanitizeText(input.error_code||'connector_error',240);}
 else if(/agent|delegate/.test(raw)||String(input.executor_type||'').toLowerCase()==='agent'){category='agent';root_cause=sanitizeText(input.error_code||'agent_error',240);}
 else if(/eas|expo/.test(raw)||String(input.executor_type||'').toLowerCase()==='eas'){category='eas';root_cause=sanitizeText(input.error_code||'eas_error',240);}
 else if(/pwa_build_mismatch|live_build_mismatch|ui_stale_state|pwa_ui_stale/.test(raw)){category='pwa';root_cause=sanitizeText(input.error_code||'pwa_failure',240);}
 else if(/planner|route|routing/.test(raw)){category='routing';root_cause=sanitizeText(input.error_code||'routing_failure',240);}
 else if(/pwa|browser|frontend|ui/.test(raw)){category='pwa';root_cause=sanitizeText(input.error_code||'pwa_failure',240);}
 else if(/runtime|gateway|runner|execution/.test(raw)){category='runtime';root_cause=sanitizeText(input.error_code||'runtime_failure',240);}
 if(status==='failed'||status==='blocked')severity=(category==='policy'||category==='auth')?'warning':'error';
 if(status==='blocked'&&/hard|dead|critical/.test(raw))severity='critical';
 if(status==='unknown')severity='warning';
 return {category,root_cause,severity};
}
function extractCorrelation(mission,events=[]){const metadata=mission?.metadata&&typeof mission.metadata==='object'?mission.metadata:{};const newest=[...events].reverse();const field=(name,...meta)=>{for(const event of newest){const p=payloadOf(event);const v=firstString(p[name],event?.[name]);if(v)return v;}return firstString(...meta);};return{trace_id:field('trace_id',metadata.trace_id),request_id:field('request_id',metadata.request_id),execution_id:field('execution_id',metadata.execution_id,metadata.job_id),router_decision_id:field('router_decision_id',metadata.router_decision_id),fallback_decision_id:field('fallback_decision_id',metadata.fallback_decision_id),diagnostic_scope:'mission:'+String(mission?.mission_id||'')};}
function extractVersions(mission,events=[]){const metadata=mission?.metadata&&typeof mission.metadata==='object'?mission.metadata:{};const checkpoint=mission?.checkpoint&&typeof mission.checkpoint==='object'?mission.checkpoint:{};const last=events[events.length-1]||{};const p=payloadOf(last);return{runtime_version:firstString(p.runtime_version,last.runtime_version,metadata.runtime_version,'aria-mission-runner-v22-universal'),planner_version:firstString(p.planner_version,metadata.planner_version,checkpoint.planner_version,'aria-planner-v11'),execution_version:firstString(p.execution_version,metadata.execution_version,checkpoint.execution_version,'aria-execution-engine-v1.1.0'),verifier_version:firstString(p.verifier_version,metadata.verifier_version,checkpoint.verifier_version,'smart-verifier-v1.1.0'),source_sha:firstString(p.source_sha,last.source_sha,metadata.release_sha,metadata.source_sha),pwa_build:firstString(metadata.pwa_build)};}
function buildEvidenceChain(events=[],jobs=[],jobEvents=[]){
 const eventEvidence=events.slice(-30).map(event=>{const p=payloadOf(event);return{event_id:event.event_id??null,created_at:event.created_at??null,event_type:event.event_type??null,step_index:event.step_index??null,attempt:Number.isFinite(Number(p.attempt))?Number(p.attempt):null,trace_id:firstString(event.trace_id,p.trace_id),span_id:firstString(event.span_id,p.span_id),request_id:firstString(event.request_id,p.request_id),execution_id:firstString(event.execution_id,p.execution_id,p.job_id),error_code:safeErrorCode(event.error_code,p.error_code,p.error?.code,p.failure?.error_code),executor_type:firstString(p.executor_type,p.executor),operation:firstString(p.operation),provider_id:firstString(p.provider_id),model_id:firstString(p.model_id),device_id:firstString(p.device_id),evidence_ref:firstString(p.evidence_ref,p.authorization?.evidence_ref)};});
 const jobEvidence=jobs.slice(-20).map(job=>({source:'execution_job',job_id:job.job_id,created_at:job.created_at||job.requested_at||null,completed_at:job.completed_at||null,status:job.status||null,device_id:job.device_id||null,operation:job.operation||null,attempt:Number.isFinite(Number(job.metadata?.attempt))?Number(job.metadata.attempt):null,error_code:safeErrorCode(job.error?.code,job.result?.error_code,job.metadata?.error_code)}));
 const jobEventEvidence=jobEvents.slice(-20).map(event=>({source:'execution_job_event',event_id:event.event_id??null,job_id:event.job_id??null,created_at:event.created_at??null,event_type:event.event_type??null,error_code:safeErrorCode(event.payload?.error_code,event.payload?.error?.code),device_id:event.device_id||null}));
 return [...eventEvidence,...jobEvidence,...jobEventEvidence].slice(-60);
}
function buildAttemptHistory(steps=[],events=[],jobs=[]){
 const history=[];
 for(const step of steps){const attempts=Number(step?.attempt_count??0);if(attempts>0)history.push({step_id:String(step.step_index),operation:step.operation||null,executor_type:step.executor_type||null,attempts,status:step.status||null,last_started_at:step.started_at||null,last_completed_at:step.completed_at||null});}
 for(const event of events){const p=payloadOf(event);if(!['step_started','step_retrying','step_failed','execution_failed','execution_timeout','recovery_attempted'].includes(String(event.event_type)))continue;const attempt=Number(p.attempt);if(!Number.isFinite(attempt))continue;history.push({source:'event',event_type:event.event_type,step_id:firstString(p.step_id),attempt,status:firstString(p.status),error_code:safeErrorCode(event.error_code,p.error_code,p.error?.code),strategy_fingerprint:firstString(p.strategy_fingerprint,p.strategy?.fingerprint),created_at:event.created_at||null});}
 for(const job of jobs){const attempt=Number(job.metadata?.attempt);if(Number.isFinite(attempt))history.push({source:'execution_job',job_id:job.job_id,attempt,status:job.status||null,error_code:safeErrorCode(job.error?.code,job.result?.error_code),created_at:job.requested_at||null,completed_at:job.completed_at||null});}
 return history.slice(-80);
}
function humanDiagnosis({mission,classification,lastFailure,dependency,attemptCount}){
 const goal=sanitizeText(mission?.goal||'la misión',260);
 const observed=sanitizeText(lastFailure?.message||lastFailure?.error_code||lastFailure?.event_type||mission?.last_stderr||mission?.status,360);
 const expected=['succeeded','failed','blocked','cancelled'].includes(String(mission?.status))?'La misión debía terminar con un estado terminal coherente y evidencia verificable.':'El paso debía completar su operación gobernada y dejar evidencia persistente.';
 let next_action='Revisar la evidencia registrada y ejecutar una estrategia gobernada que no repita la misma hipótesis fallida.';
 const category=classification.category;
 if(category==='timeout')next_action='Revisar el executor, el timeout y el estado del watchdog; no repetir ciegamente el mismo intento.';
 else if(category==='backpressure')next_action='Reducir la concurrencia o esperar capacidad; comprobar la policy global y por dispositivo.';
 else if(category==='lease')next_action='Comprobar owner/lease/reclaim antes de volver a encolar el trabajo.';
 else if(category==='credential')next_action='Corregir la credencial o ruta de autenticación y luego reintentar con evidencia nueva.';
 else if(category==='device')next_action='Comprobar el dispositivo, su heartbeat y el job/lease asociado antes de reintentar.';
 else if(category==='provider'||category==='model')next_action='Comprobar salud/availability observada y usar una ruta alternativa gobernada si la evidencia lo permite.';
 else if(category==='verifier')next_action='Revisar la evidencia de verificación y corregir la discrepancia antes de marcar el resultado como válido.';
 else if(category==='policy'||category==='auth')next_action='Completar la condición de autorización/Human Gate requerida; no omitirla.';
 else if(category==='connector')next_action='Comprobar la dependencia externa y su evidencia de disponibilidad antes de repetir la operación.';
 else if(category==='pwa')next_action='Comprobar build LIVE, cache/asset identity y API boundary antes de repetir la interacción.';
 return{root_cause:classification.root_cause,summary:classification.category.toUpperCase()+': '+sanitizeText(classification.root_cause,180),explanation:'ARIA observó '+observed+'. La misión solicitó: '+goal+'. La clasificación actual es '+category+'.',expected,observed,dependency,next_action,attempts_observed:attemptCount};
}
function deriveOperationalDiagnostic({mission,steps=[],events=[],jobs=[],jobEvents=[],health={}}){
 let lastFailure=null;const failureEventTypes=new Set(['planner_failed','step_failed','execution_failed','execution_timeout','mission_failed','mission_hard_blocked','agent_executor_diagnostic','learning_preflight_blocked']);
 for(const event of events){const eventType=String(event.event_type||'');const payload=payloadOf(event);if(failureEventTypes.has(eventType)||((mission?.status==='failed'||mission?.status==='blocked')&&(firstString(event.error_code,payload.error_code,payload.error?.code))))lastFailure=event;}
 const lastPayload=payloadOf(lastFailure);
 const classification=classifyDiagnostic({status:mission?.status,event_type:lastFailure?.event_type,error_code:firstString(lastFailure?.error_code,lastPayload.error_code,lastPayload.error?.code),message:firstString(lastPayload.message,lastPayload.error?.message,mission?.last_stderr),recovery_status:mission?.checkpoint?.recovery?.status,executor_type:firstString(lastPayload.executor_type),operation:firstString(lastPayload.operation)});
 const dependency={executor_type:firstString(lastPayload.executor_type),provider_id:firstString(lastPayload.provider_id),model_id:firstString(lastPayload.model_id),device_id:firstString(lastPayload.device_id),operation:firstString(lastPayload.operation)};
 const attempts=buildAttemptHistory(steps,events,jobs);
 const evidence_chain=buildEvidenceChain(events,jobs,jobEvents);
 const correlation=extractCorrelation(mission,events);
 const versions=extractVersions(mission,events);const consistency=analyzeMissionConsistency({mission,steps,events,jobs,jobEvents});
 const finalClassification=mission?.status==='succeeded'?{category:'unknown',root_cause:'none',severity:'info'}:classification;
 const finalDiagnosis=humanDiagnosis({mission,classification:finalClassification,lastFailure:lastFailure?{event_type:lastFailure.event_type,error_code:firstString(lastFailure.error_code,lastPayload.error_code,lastPayload.error?.code),message:firstString(lastPayload.message,lastPayload.error?.message,mission?.last_stderr)}:null,dependency,attemptCount:attempts.length});
 if(finalClassification.root_cause==='none') finalDiagnosis.summary='SIN FALLOS DETECTADOS';
 if(finalClassification.root_cause==='none') finalDiagnosis.explanation='ARIA no detectó un fallo operacional en la evidencia disponible para esta misión.';
 return{version:registry.version,mission_id:String(mission?.mission_id||''),status:String(mission?.status||'unknown'),generated_at:new Date().toISOString(),correlation,classification:finalClassification,diagnosis:finalDiagnosis,versions,attempts,evidence_chain,consistency,health:{...health,dependency,status:String(health.status||'unknown')}};
}
export {sanitizeText,classifyDiagnostic,extractCorrelation,extractVersions,buildEvidenceChain,buildAttemptHistory,humanDiagnosis,deriveOperationalDiagnostic};
