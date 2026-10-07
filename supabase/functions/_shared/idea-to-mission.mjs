'use strict';

const MAX_IDEA_LENGTH = 4000;
const SCHEMA_VERSION = 'idea-to-mission-v3';
const P = Object.freeze({
  human: [/\bhuman gate\b/i,/\bintervenci[oó]n humana\b/i,/\bverificaci[oó]n humana\b/i,/\bmanual(?:mente)?\b/i,/\bmi aprobaci[oó]n\b/i],
  payment: [/\b(pago|pagar|billing|subscription|suscripci[oó]n|quota|cuota)\b/i,/\b(api key|clave de api|credencial|credential|token|secreto|secret)\b/i],
  device: [/\b(android|tel[eé]fono|phone|usb|adb|dispositivo|device|c[aá]mara|micr[oó]fono|browser|navegador)\b/i],
  dependency: [/\b(depende|dependencia|dependency|prerrequisito|prerequisite)\b/i,/\bbloquead[oa]\b.*\b(hasta|until|antes|before)\b/i,/\brequiere\b.*\b(primero|first|antes)\b/i],
  capability: [/\b(nueva capacidad|capacidad nueva|new capability|capability gap|gap de capacidad)\b/i,/\bnuevo\s+(modelo|agente|proveedor|conector)\b/i],
  governance: [/\b(seguridad|security|gobernanza|governance|permiso|permissions?|autorizaci[oó]n|production|producci[oó]n|merge)\b/i],
  deferred: [/\b(diferir|diferido|deferred|postponer|postpone|m[aá]s adelante|later|despu[eé]s)\b/i],
  notViable: [/\b(no\s+(?:es\s+)?viable|not viable|imposible|impossible|no se puede|cannot be done|not possible|fuera de alcance|out of scope)\b/i],
  mutation: [/\b(crear|implementar|modificar|actualizar|a[nñ]adir|anadir|eliminar|desarrollar|refactorizar|escribir|migrar|reparar|corregir|fix|build|implement|modify|update|add|remove|develop|refactor|write|migrate|repair)\b/i]
});

const text = (v) => typeof v === 'string' ? v.trim() : '';
const uniq = (a) => [...new Set((a || []).filter(Boolean))];
const key = (v) => text(v).toLowerCase().replace(/\s+/g,' ').trim();
const any = (v, ps) => ps.some((p) => p.test(v));

function classifyIdea(idea) {
  const s = text(idea);
  const signals = {
    human_gate_required: any(s,P.human),
    payment_or_credential_block: any(s,P.payment),
    device_or_connection_required: any(s,P.device),
    dependency_required: any(s,P.dependency),
    capability_gap: any(s,P.capability),
    governance_or_security: any(s,P.governance),
    deferred: any(s,P.deferred),
    not_viable: any(s,P.notViable),
    mutation_required: any(s,P.mutation)
  };
  const blockers = [];
  if (signals.not_viable) blockers.push({code:'NOT_VIABLE_CURRENTLY',reason:'La idea declara o implica inviabilidad actual.'});
  if (signals.payment_or_credential_block) blockers.push({code:'PAYMENT_OR_CREDENTIAL',reason:'La ejecución depende de pago, cuota o credencial externa.'});
  if (signals.governance_or_security) blockers.push({code:'GOVERNANCE_REVIEW',reason:'La idea toca una frontera de seguridad, permisos o producción.'});
  if (signals.device_or_connection_required) blockers.push({code:'DEVICE_OR_CONNECTION',reason:'La ejecución requiere un dispositivo o conexión física/externa.'});
  if (signals.dependency_required) blockers.push({code:'PREREQUISITE',reason:'La idea declara una dependencia o prerrequisito.'});
  let viability='viable_now';
  if(signals.not_viable) viability='not_viable_currently'; else if(signals.deferred) viability='deferred';
  let state='ready_for_review';
  if(signals.not_viable) state='blocked';
  else if(signals.payment_or_credential_block) state='blocked_payment_or_credential';
  else if(signals.governance_or_security) state='human_gate_or_governance_review';
  else if(signals.device_or_connection_required) state='device_dependency';
  else if(signals.human_gate_required) state='human_gate_required';
  else if(signals.dependency_required) state='dependency_check';
  const categories=uniq([
    signals.mutation_required?'implementation':'analysis',
    signals.capability_gap?'capability_gap':null,
    signals.device_or_connection_required?'device':null,
    signals.payment_or_credential_block?'payment_or_credential':null,
    signals.governance_or_security?'governance':null,
    signals.human_gate_required?'human_gate':null,
    signals.dependency_required?'dependency':null
  ]);
  return {
    scope:(signals.payment_or_credential_block||signals.device_or_connection_required)?'aria_plus_external_dependency':'aria',
    viability,
    execution_state:state,
    categories,
    signals,
    ...signals,
    blockers,
    intervention:(signals.human_gate_required||signals.governance_or_security)?'human_required':'none'
  };
}

function objectiveFromIdea(idea,c){
  return {
    objective_id:'objective_1',
    title:'Resultado que ARIA entendió',
    text:text(idea),
    acceptance:'La idea termina convertida en un único resultado ejecutable, verificable y trazable.',
    verifier:'Comprobar resultado, evidencia, dependencias y cierre sin autoejecutar antes de tu elección.',
    scope:c.scope
  };
}

function subobjectives(c){
  const rows=[
    {id:'subobjective_1',title:'Entender el resultado',description:'Convertir la idea en un objetivo concreto y verificable.',depends_on:[]},
    {id:'subobjective_2',title:'Comparar rutas',description:'Proponer alternativas con diferencias claras de alcance, riesgo y esfuerzo.',depends_on:['subobjective_1']},
    {id:'subobjective_3',title:'Ejecutar y comprobar',description:'Crear una única misión a partir del plan que elijas y cerrar con evidencia.',depends_on:['subobjective_2']}
  ];
  if(c.capability_gap) rows.splice(2,0,{id:'subobjective_capability',title:'Cerrar o comprobar la capacidad faltante',description:'Identificar la capacidad necesaria antes de comprometer la ejecución.',depends_on:['subobjective_2']});
  return rows;
}

function gate(enabled){
  return {
    enabled,
    method:enabled?'manual_confirmation':null,
    instructions:enabled?'Revisar alcance, destino y acción sensible antes de aprobar.':null
  };
}

function planOptions(c){
  const writeRisk=c.mutation_required?'LOW_RISK_WRITE':'READ';
  const executor=c.capability_gap?'agent':'connector';
  const action=c.mutation_required?'idea.apply_change':'idea.execute_improvement';
  const commonBlockers=c.blockers.slice();
  if(c.device_or_connection_required) commonBlockers.push({code:'DEVICE_REQUIRED',reason:'La ruta requiere un dispositivo o conexión explícita.'});
  const humanGate=c.human_gate_required||c.governance_or_security;
  return [
    {
      id:'plan_a',
      title:'Plan A · Mínimo',
      summary:'La ruta más pequeña para obtener el resultado pedido, con el menor alcance posible.',
      tradeoffs:'Menos trabajo y menor superficie de cambio; cubre solo lo necesario.',
      recommended:false,
      goal:'Lograr el resultado solicitado con el mínimo cambio gobernado.',
      risk:writeRisk,
      executor_type:executor,
      human_gate:gate(humanGate),
      blockers:commonBlockers,
      steps:[
        {id:'step_1',title:'Preparar la ruta',operation:'idea.prepare_change',risk:'READ',executor_type:'planner',depends_on:[]},
        {id:'step_2',title:'Aplicar el cambio mínimo',operation:action,risk:writeRisk,executor_type:executor,depends_on:['step_1']},
        {id:'step_3',title:'Verificar el resultado',operation:'idea.verify',risk:'READ',executor_type:'verifier',depends_on:['step_2']}
      ]
    },
    {
      id:'plan_b',
      title:'Plan B · Equilibrado',
      summary:'Equilibra alcance, seguridad y verificación; es la ruta recomendada por defecto.',
      tradeoffs:'Un poco más de trabajo a cambio de una comprobación y evidencia más completas.',
      recommended:true,
      goal:'Implementar el resultado con una ruta gobernada, comprobación y evidencia de cierre.',
      risk:writeRisk,
      executor_type:executor,
      human_gate:gate(humanGate),
      blockers:commonBlockers,
      steps:[
        {id:'step_1',title:'Preparar ruta y dependencias',operation:'idea.prepare_change',risk:'READ',executor_type:'planner',depends_on:[]},
        {id:'step_2',title:'Aplicar el cambio',operation:action,risk:writeRisk,executor_type:executor,depends_on:['step_1']},
        {id:'step_3',title:'Comprobar comportamiento y resultado',operation:'idea.verify',risk:'READ',executor_type:'verifier',depends_on:['step_2']},
        {id:'step_4',title:'Registrar evidencia de cierre',operation:'idea.evidence',risk:'READ',executor_type:'verifier',depends_on:['step_3']}
      ]
    },
    {
      id:'plan_c',
      title:'Plan C · Robusto',
      summary:'Incluye comprobaciones adicionales para reducir regresiones y dejar más evidencia.',
      tradeoffs:'Mayor tiempo y alcance; útil cuando el cambio tendrá uso continuado o riesgo de regresión.',
      recommended:false,
      goal:'Implementar el resultado y añadir comprobaciones de regresión antes del cierre.',
      risk:writeRisk,
      executor_type:executor,
      human_gate:gate(humanGate),
      blockers:commonBlockers,
      steps:[
        {id:'step_1',title:'Preparar ruta y dependencias',operation:'idea.prepare_change',risk:'READ',executor_type:'planner',depends_on:[]},
        {id:'step_2',title:'Aplicar el cambio',operation:action,risk:writeRisk,executor_type:executor,depends_on:['step_1']},
        {id:'step_3',title:'Verificar resultado',operation:'idea.verify',risk:'READ',executor_type:'verifier',depends_on:['step_2']},
        {id:'step_4',title:'Ejecutar comprobación de regresión',operation:'idea.regression_check',risk:'READ',executor_type:'verifier',depends_on:['step_3']},
        {id:'step_5',title:'Registrar evidencia de cierre',operation:'idea.evidence',risk:'READ',executor_type:'verifier',depends_on:['step_4']}
      ]
    }
  ];
}

function missions(c, idea){
  const plans=planOptions(c);
  const recommended=plans.find(p=>p.recommended)||plans[1];
  return [{
    mission_id:'idea_mission_main',
    title:'Misión derivada de la idea',
    goal:recommended.goal,
    status:(c.not_viable||c.payment_or_credential_block)?'blocked':'proposed',
    risk:recommended.risk,
    executor_type:recommended.executor_type,
    depends_on:[],
    human_gate:recommended.human_gate,
    blockers:recommended.blockers,
    plans,
    selected_plan_id:recommended.id,
    steps:recommended.steps
  }];
}

function summaryForIdea(idea,c,ms){
  const plans=ms[0]?.plans||[];
  const recommended=plans.find(p=>p.recommended)||plans[1]||plans[0];
  const blockers=(c.blockers||[]).map(b=>b.reason).filter(Boolean);
  return {
    objective:'Una sola misión elegida por ti.',
    human_explanation:'ARIA entendió la idea, detectó las restricciones principales y preparó tres rutas. Todavía no ejecuta ninguna hasta que elijas.',
    what_i_understood:text(idea),
    recommended_plan:recommended?.id||'plan_b',
    recommended_plan_title:recommended?.title||'Plan B · Equilibrado',
    why_recommended:'Es la ruta equilibrada entre alcance, riesgo y evidencia de cierre.',
    tradeoffs:plans.map(p=>({id:p.id,title:p.title,summary:p.summary,tradeoffs:p.tradeoffs})),
    dependencies:blockers.length?blockers:['No se detectaron bloqueos externos explícitos.'],
    verification:'ARIA verificará el resultado elegido y conservará la evidencia de cierre.',
    classification:c.execution_state,
    viability:c.viability,
    mission_count:1,
    plan_count:plans.length,
    blocked_missions:ms.filter(x=>x.status==='blocked').length,
    human_gate_required:ms.some(x=>x.human_gate.enabled),
    auto_enqueue:false
  };
}

function stable(v){
  if(Array.isArray(v)) return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}

async function sha256(s){
  const bytes=new TextEncoder().encode(s);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
}

async function buildIdeaMissionProposal(idea,context={}){
  const normalized=text(idea);
  if(!normalized) throw new TypeError('idea_required');
  if(normalized.length>MAX_IDEA_LENGTH) throw new RangeError('idea_too_long');
  const c=classifyIdea(normalized);
  const objective=objectiveFromIdea(normalized,c);
  const subs=subobjectives(c);
  const ms=missions(c,normalized);
  const canonical={
    schema_version:SCHEMA_VERSION,
    input:{idea:normalized},
    classification:c,
    objective,
    subobjectives:subs,
    missions:ms,
    queue_policy:{mode:'manual_only',auto_enqueue:false,auto_execute:false,human_decision_required:true},
    closure:{required:true,rule:'one_selected_plan_creates_one_mission'}
  };
  const fingerprint=await sha256(key(normalized));
  return {
    proposal_id:'proposal_'+fingerprint.slice(0,24),
    fingerprint,
    created_from:{source:'meditation-idea-analyzer-v3',device_id:text(context.device_id)||null,created_by:text(context.created_by)||'robert'},
    ...canonical,
    summary:summaryForIdea(normalized,c,ms)
  };
}

function validateProposal(p){
  if(!p||p.schema_version!==SCHEMA_VERSION) return {valid:false,reason:'schema_version'};
  if(!p.proposal_id||!p.fingerprint||!p.input?.idea) return {valid:false,reason:'identity_or_idea'};
  if(!p.objective?.text||!p.objective?.acceptance||!p.objective?.verifier) return {valid:false,reason:'objective'};
  if(!Array.isArray(p.subobjectives)||!p.subobjectives.length) return {valid:false,reason:'subobjectives'};
  if(!Array.isArray(p.missions)||p.missions.length!==1) return {valid:false,reason:'single_mission_required'};
  const mission=p.missions[0];
  if(!mission?.mission_id||!Array.isArray(mission?.plans)||mission.plans.length!==3) return {valid:false,reason:'three_plan_options_required'};
  const planIds=new Set();
  for(const plan of mission.plans){
    if(!plan?.id||planIds.has(plan.id)||!Array.isArray(plan.steps)||!plan.steps.length) return {valid:false,reason:'invalid_plan'};
    planIds.add(plan.id);
  }
  if(p.queue_policy?.auto_enqueue!==false||p.queue_policy?.auto_execute!==false) return {valid:false,reason:'auto_queue_forbidden'};
  return {valid:true,reason:null};
}

export { MAX_IDEA_LENGTH, SCHEMA_VERSION, classifyIdea, buildIdeaMissionProposal, validateProposal };
