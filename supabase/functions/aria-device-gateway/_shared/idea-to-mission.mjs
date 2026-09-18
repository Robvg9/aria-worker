'use strict';

const MAX_IDEA_LENGTH = 4000;
const SCHEMA_VERSION = 'idea-to-mission-v1';
const P = Object.freeze({
  human: [/\bhuman gate\b/i,/\bintervenci[oó]n humana\b/i,/\bverificaci[oó]n humana\b/i,/\bmanual(?:mente)?\b/i,/\bmi aprobaci[oó]n\b/i],
  payment: [/\b(pago|pagar|billing|subscription|suscripci[oó]n|quota|cuota)\b/i,/\b(api key|clave de api|credencial|credential|token|secreto|secret)\b/i],
  device: [/\b(android|tel[eé]fono|phone|usb|adb|dispositivo|device|c[aá]mara|micr[oó]fono|browser|navegador)\b/i],
  dependency: [/\b(depende|dependencia|dependency|prerequisito|prerequisite)\b/i,/\bbloquead[oa]\b.*\b(hasta|until|antes|before)\b/i,/\brequiere\b.*\b(primero|first|antes)\b/i],
  capability: [/\b(nueva capacidad|capacidad nueva|new capability|capability gap|gap de capacidad)\b/i,/\bnuevo\s+(modelo|agente|proveedor|conector)\b/i],
  governance: [/\b(seguridad|security|gobernanza|governance|permiso|permissions?|autorizaci[oó]n|production|producci[oó]n|merge)\b/i],
  deferred: [/\b(diferir|diferido|deferred|postponer|postpone|m[aá]s adelante|later|despu[eé]s)\b/i],
  notViable: [/\b(no viable|not viable|imposible|impossible|no se puede|cannot be done|not possible|fuera de alcance|out of scope)\b/i],
  mutation: [/\b(crear|crear|implementar|modificar|actualizar|a[nñ]adir|anadir|eliminar|desarrollar|refactorizar|escribir|migrar|reparar|corregir|fix|build|implement|modify|update|add|remove|develop|refactor|write|migrate|repair)\b/i]
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
    signals.mutation_required?'implementation': 'analysis',
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
    blockers,
    intervention:(signals.human_gate_required||signals.governance_or_security)?'human_required':'none'
  };
}

function objectiveFromIdea(idea,c){
  return {
    objective_id:'objective_1',
    title:'Convertir en resultado verificable: '+text(idea).replace(/[.!?]+$/g,'').slice(0,96),
    text:text(idea),
    acceptance:'La propuesta queda estructurada, inspeccionable, trazable y no se autoencola.',
    verifier:'Validación de esquema, dependencias, Human Gate/bloqueos y no autoencolado.',
    scope:c.scope
  };
}

function subobjectives(c){
  const rows=[
    {id:'subobjective_1',title:'Definir objetivo y criterio de éxito',description:'Traducir la idea a un objetivo concreto con aceptación y verificador.',depends_on:[]},
    {id:'subobjective_2',title:'Analizar dependencias y fronteras',description:'Identificar prerrequisitos, dispositivos, credenciales, capacidades y gobernanza.',depends_on:['subobjective_1']},
    {id:'subobjective_3',title:'Descomponer en misiones ejecutables',description:'Crear misiones propuestas con pasos y dependencias.',depends_on:['subobjective_1','subobjective_2']},
    {id:'subobjective_4',title:'Definir verificación y siguiente decisión',description:'Definir evidencia requerida y mantener control humano de la cola.',depends_on:['subobjective_3']}
  ];
  if(c.capability_gap) rows.splice(2,0,{id:'subobjective_capability',title:'Cerrar o verificar la capacidad faltante',description:'Convertir el gap detectado en una misión explícita antes de depender de esa capacidad.',depends_on:['subobjective_2']});
  return rows;
}

function missions(c){
  const gate=(enabled)=>({enabled,method:enabled?'manual_confirmation':null,instructions:enabled?'Revisar y confirmar la decisión humana requerida antes de promocionar o ejecutar una acción sensible.':null});
  const m=[
    {mission_id:'idea_mission_1',title:'Análisis y objetivo',goal:'Validar la idea, objetivo, aceptación y alcance.',status:'proposed',risk:'READ',executor_type:'planner',depends_on:[],human_gate:gate(false),blockers:[],steps:[
      {id:'step_1',title:'Normalizar idea',operation:'idea.normalize',risk:'READ',executor_type:'planner',depends_on:[]},
      {id:'step_2',title:'Definir aceptación',operation:'idea.acceptance',risk:'READ',executor_type:'planner',depends_on:['step_1']}
    ]},
    {mission_id:'idea_mission_2',title:'Dependencias y gobernanza',goal:'Verificar prerrequisitos, dispositivos, credenciales, capacidades y gobernanza.',status:'proposed',risk:c.governance_or_security?'MEDIUM':'READ',executor_type:c.device_or_connection_required?'device':'planner',depends_on:['idea_mission_1'],human_gate:gate(c.human_gate_required||c.governance_or_security),blockers:c.blockers.slice(),steps:[
      {id:'step_1',title:'Comprobar dependencias',operation:'idea.dependencies',risk:'READ',executor_type:'planner',depends_on:[]},
      {id:'step_2',title:'Resolver fronteras',operation:'idea.governance_check',risk:c.governance_or_security?'MEDIUM':'READ',executor_type:c.device_or_connection_required?'device':'planner',depends_on:['step_1']}
    ]},
    {mission_id:'idea_mission_3',title:c.mutation_required?'Implementación gobernada':'Resolución / mejora propuesta',goal:c.mutation_required?'Implementar el cambio propuesto en una ruta gobernada.':'Aplicar la mejora propuesta en la menor ruta gobernada necesaria.',status:(c.not_viable||c.payment_or_credential_block)?'blocked':'proposed',risk:c.mutation_required?'LOW_RISK_WRITE':'READ',executor_type:c.capability_gap?'agent':'connector',depends_on:['idea_mission_2'],human_gate:gate(c.human_gate_required||c.governance_or_security),blockers:c.blockers.slice(),steps:[
      {id:'step_1',title:'Preparar ruta gobernada',operation:'idea.prepare_change',risk:'READ',executor_type:'planner',depends_on:[]},
      {id:'step_2',title:'Aplicar cambio',operation:c.mutation_required?'idea.apply_change':'idea.execute_improvement',risk:c.mutation_required?'LOW_RISK_WRITE':'READ',executor_type:c.capability_gap?'agent':'connector',depends_on:['step_1']}
    ]},
    {mission_id:'idea_mission_4',title:'Verificación y evidencia',goal:'Verificar resultado, evidencia y criterio de cierre.',status:c.not_viable?'blocked':(c.deferred?'deferred':'proposed'),risk:'READ',executor_type:'verifier',depends_on:['idea_mission_3'],human_gate:gate(false),blockers:[],steps:[
      {id:'step_1',title:'Verificar resultado',operation:'idea.verify',risk:'READ',executor_type:'verifier',depends_on:[]},
      {id:'step_2',title:'Registrar evidencia',operation:'idea.evidence',risk:'READ',executor_type:'verifier',depends_on:['step_1']}
    ]}
  ];
  if(c.device_or_connection_required) m[1].blockers.push({code:'DEVICE_REQUIRED',reason:'No se debe autoejecutar sin la conexión/dispositivo declarado.'});
  if(c.deferred) m.forEach((x,i)=>{if(i>0&&x.status==='proposed')x.status='deferred';});
  return m;
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
  const ms=missions(c);
  const canonical={schema_version:SCHEMA_VERSION,input:{idea:normalized},classification:c,objective,subobjectives:subs,missions:ms,queue_policy:{mode:'manual_only',auto_enqueue:false,auto_execute:false,human_decision_required:true},closure:{required:true,rule:'inspectable_plan_without_auto_queue'}};
  const fingerprint=await sha256(key(normalized));
  return {proposal_id:'proposal_'+fingerprint.slice(0,24),fingerprint,created_from:{source:'meditation-idea-to-mission-v1',device_id:text(context.device_id)||null,created_by:text(context.created_by)||'robert'},...canonical,summary:{objective:objective.title,classification:c.execution_state,viability:c.viability,mission_count:ms.length,blocked_missions:ms.filter(x=>x.status==='blocked').length,human_gate_required:ms.some(x=>x.human_gate.enabled),auto_enqueue:false}};
}

function validateProposal(p){
  if(!p||p.schema_version!==SCHEMA_VERSION) return {valid:false,reason:'schema_version'};
  if(!p.proposal_id||!p.fingerprint||!p.input?.idea) return {valid:false,reason:'identity_or_idea'};
  if(!p.objective?.text||!p.objective?.acceptance||!p.objective?.verifier) return {valid:false,reason:'objective'};
  if(!Array.isArray(p.subobjectives)||!p.subobjectives.length) return {valid:false,reason:'subobjectives'};
  if(!Array.isArray(p.missions)||!p.missions.length) return {valid:false,reason:'missions'};
  if(p.queue_policy?.auto_enqueue!==false||p.queue_policy?.auto_execute!==false) return {valid:false,reason:'auto_queue_forbidden'};
  const ids=new Set();
  for(const m of p.missions){
    if(!m.mission_id||ids.has(m.mission_id)) return {valid:false,reason:'duplicate_mission_id'};
    ids.add(m.mission_id);
    for(const dep of m.depends_on||[]) if(!ids.has(dep)) return {valid:false,reason:'mission_dependency_order'};
  }
  return {valid:true,reason:null};
}

export { MAX_IDEA_LENGTH, SCHEMA_VERSION, classifyIdea, buildIdeaMissionProposal, validateProposal };
