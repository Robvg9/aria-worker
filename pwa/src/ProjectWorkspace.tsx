// ARTIA RELEASE: project previews for ARIA + CuevaCoin
// LIVE preview contract: ARIA uses the canonical PWA; CuevaCoin uses the governed visual source preview so ARTIA can pause and annotate it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { missionGoalPreview, missionHumanTitle, missionListLabel } from './missionPresentation';

type Session = { accessToken: string; userId: string };
type ChatMessage = { id:string; role:'user'|'aria'; text:string; processingMs?:number };
type Project = { id: string; name: string; description: string; icon: string; context: string; previewUrl?: string; previewMode?: 'live' | 'source' | 'reference' | 'auth-required' };
type BattleCruiserClientConfig = { supabase_url:string; publishable_key:string };
type ActiveBattleCruiserConnection = { ariaUserId:string; accessToken:string; refreshToken:string; expiresAt:number; user:{id:string;email:string|null}; clientConfig:BattleCruiserClientConfig; verifiedChecks?:any };
let activeBattleCruiserConnection: ActiveBattleCruiserConnection | null = null;
type Tool = 'pen'|'marker'|'line'|'rect'|'circle'|'arrow'|'text'|'eraser';
type Point = { x:number; y:number };
type DrawAction = { tool:Tool; color:string; size:number; points:Point[]; text?:string };

const API = '/api';
function formatProcessingTime(ms:number):string{const value=Math.max(0,Number(ms)||0);if(value<1000)return value+' ms';return (value/1000).toFixed(value<10000?1:0)+' s';}
function processingLabel(ms:number):string{if(ms<1500)return 'ARIA está analizando tu mensaje…';if(ms<4000)return 'ARIA está procesando el contexto…';if(ms<10000)return 'ARIA está razonando y preparando la respuesta…';return 'ARIA sigue procesando la respuesta…';}
const HUMAN_API_ERRORS: Record<string,string> = {
  app_api_unreachable:'No pude conectar con ARIA. Revisa la conexión e inténtalo de nuevo.',
  conversation_persist_failed:'No se pudo guardar el mensaje. ARIA puede seguir intentando responder y conservar la conversación.',
  conversation_model_execution_failed:'El modelo que tomó la solicitud no pudo completar la respuesta. Puedes reintentarlo.',
  conversation_planner_failed:'El planificador de ARIA no respondió. Puedes reintentarlo.',
  invalid_or_expired_session:'La sesión de ARIA expiró. Vuelve a entrar para continuar.'
};
const PROJECTS: Project[] = [
  { id:'battlecruiser', name:'BattleCruiser', description:'Sistema operativo privado para organizar el trabajo y la operación de La Cueva.', icon:'🏴‍☠️', context:'BattleCruiser es un proyecto operativo privado. Fuentes canónicas: GitHub https://github.com/Robvg9/battlecruiser/tree/main; frontend LIVE https://battlecruiser.robvg9.workers.dev/; Supabase propio ref papxnkkjtkxsitcsvcme y API https://papxnkkjtkxsitcsvcme.supabase.co. No desconectar la conexión de Supabase de ARIA ni sustituirla por la de BattleCruiser. La vista ARTIA usa el frontend LIVE real en modo auth-required; si no existe sesión, mostrará el login y no se considera verificado el dashboard. Con una sesión BC conectada, ARIA puede obtener un snapshot acotado de solo lectura del usuario, perfil, permisos, turnos y reporte de ventas mediante RPC del propio backend. No guarda el token en almacenamiento persistente ni hace mutaciones con esa sesión. Sin conexión o permisos, no afirma disponer de datos; el acceso administrador, cambios de esquema y SQL requieren un canal servidor separado y autorizado. Cambios de código mediante branch, pruebas y PR.', previewUrl:'https://battlecruiser.robvg9.workers.dev/', previewMode:'auth-required' },
  { id:'cuevacoin', name:'CuevaCoin', description:'Aplicación financiera/operativa vinculada al ecosistema de negocios.', icon:'🪙', context:'CuevaCoin es un proyecto financiero/operativo. Los cambios requieren verificación adicional antes de considerarse terminados.', previewUrl:'https://aria.robvg9.workers.dev/project-preview/cuevacoin/', previewMode:'source' },
  { id:'aria', name:'ARIA', description:'Núcleo cognitivo autónomo, gobernado y verificable.', icon:'🧠', context:'ARIA es el sistema cognitivo operativo. Usa el estado LIVE, main y evidencia persistida como fuentes prioritarias.', previewUrl:'https://aria.robvg9.workers.dev/project-preview/aria/', previewMode:'live' }
];


function ariaUserIdFromAccessToken(token:string):string|null{
  try{
    const part=String(token||'').split('.')[1];
    if(!part)return null;
    const base64=part.replace(/-/g,'+').replace(/_/g,'/');
    const padded=base64+'='.repeat((4-base64.length%4)%4);
    const payload=JSON.parse(atob(padded));
    return typeof payload?.sub==='string'&&payload.sub.trim()?payload.sub:null;
  }catch{return null;}
}

async function getActiveBattleCruiserAccessToken(ariaUserId:string|null):Promise<string|null>{
  const current=activeBattleCruiserConnection;
  if(!current||!ariaUserId||current.ariaUserId!==ariaUserId)return null;
  if(current.expiresAt>Date.now()+45000)return current.accessToken;
  if(!current.refreshToken){if(current.expiresAt<=Date.now())activeBattleCruiserConnection=null;return current.expiresAt>Date.now()?current.accessToken:null;}
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),7000);
  try{
    const response=await fetch(current.clientConfig.supabase_url+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:{apikey:current.clientConfig.publishable_key,'content-type':'application/json'},
      body:JSON.stringify({refresh_token:current.refreshToken}),
      cache:'no-store',
      signal:controller.signal
    });
    const data:any=await response.json().catch(()=>null);
    if(!response.ok||!data?.access_token){
      if(current.expiresAt<=Date.now())activeBattleCruiserConnection=null;
      return current.expiresAt>Date.now()?current.accessToken:null;
    }
    activeBattleCruiserConnection={
      ariaUserId:current.ariaUserId,
      accessToken:String(data.access_token),
      refreshToken:String(data.refresh_token||current.refreshToken),
      expiresAt:Date.now()+Math.max(60,Number(data.expires_in)||3600)*1000,
      user:{id:String(data.user?.id||current.user.id),email:typeof data.user?.email==='string'?data.user.email:current.user.email},
      clientConfig:current.clientConfig
    };
    return activeBattleCruiserConnection.accessToken;
  }catch{
    if(current.expiresAt<=Date.now())activeBattleCruiserConnection=null;
    return current.expiresAt>Date.now()?current.accessToken:null;
  }finally{window.clearTimeout(timeout);}
}

async function api(path:string, token:string, init:RequestInit={}) {
  const headers = new Headers(init.headers);
  headers.set('authorization','Bearer '+token);
  const requestBodyText=typeof init.body==='string'?init.body:'';
  const isBattleCruiserChat=path==='/conversation'&&requestBodyText.includes('"project_id":"battlecruiser"');
  const isBattleCruiserMissionIntake=path==='/missions'&&requestBodyText.includes('"project_id":"battlecruiser"');
  const isBattleCruiserProjectMissions=path.startsWith('/projects/battlecruiser/missions');
  if(isBattleCruiserChat||isBattleCruiserMissionIntake||isBattleCruiserProjectMissions){
    const bcToken=await getActiveBattleCruiserAccessToken(ariaUserIdFromAccessToken(token));
    if(bcToken)headers.set('x-battlecruiser-access-token',bcToken);
  }
  if (init.body) headers.set('content-type','application/json');
  const method=String(init.method||'GET').toUpperCase();
  const controller=new AbortController();
  // Canonical visual mission intake has shown ~40s latency even when it succeeds.
  // Give it a bounded 120s window so the UI doesn't report a false failure after the server has committed.
  const timeoutMs=method==='GET'?(path.includes('/projects/')&&path.endsWith('/conversation')?12000:15000):path==='/missions'?120000:30000;
  const timeout=window.setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response = await fetch(API+path,{...init,headers,cache:'no-store',signal:controller.signal});
    const raw = await response.text();
    let data:any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!response.ok) {
      const code=String(data?.error_description || data?.error || 'aria_api_error');
      throw new Error(HUMAN_API_ERRORS[code] ?? code);
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name==='AbortError') throw new Error(method==='GET'?'ARIA tardó demasiado en actualizar el chat.':'ARIA lleva demasiado tiempo procesando esta solicitud. Puedes reintentar sin perder el mensaje.');
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
}

function statusLabel(status:string) {
  const map:any = {succeeded:'Completada',failed:'Fallida',blocked:'Bloqueada',waiting:'Esperando verificación',running:'Ejecutándose',queued:'En cola',planning:'Planificando',paused:'Pausada',cancelled:'Cancelada'};
  return map[status] || status;
}
function statusClass(status:string) {
  if (status === 'succeeded') return 'good';
  if (['failed','blocked','cancelled'].includes(status)) return 'bad';
  if (['running','queued','planning','waiting','paused'].includes(status)) return 'live';
  return 'neutral';
}
function resultText(m:any) {
  const direct = [m?.last_stdout,m?.last_stderr].filter((x:any)=>typeof x==='string'&&x.trim()).join('\n\n');
  if (direct) return direct;
  const results = m?.checkpoint?.results && typeof m.checkpoint.results === 'object' ? m.checkpoint.results : {};
  const out:string[] = [];
  Object.values(results).forEach((v:any) => {
    const candidates = [v?.response?.content,v?.response?.text,v?.stdout,v?.output,v?.message,v?.result?.response?.content];
    const hit = candidates.find((x:any)=>typeof x==='string'&&x.trim());
    if (hit) out.push(String(hit).trim());
  });
  return out.join('\n\n');
}

function renderProjectMarkdown(value:string) {
  return String(value ?? '').replace(/\r/g,'').split('\n').map((line,index) => {
    const parts = line.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|\x60[^\x60\n]+\x60)/g).filter(Boolean).map((part,i) => {
      if (/^\*\*[\s\S]+\*\*$/.test(part)) return <strong key={index+'-'+i}>{part.slice(2,-2)}</strong>;
      if (/^\*[\s\S]+\*$/.test(part)) return <strong key={index+'-'+i}>{part.slice(1,-1)}</strong>;
      if (/^\x60[\s\S]+\x60$/.test(part)) return <code key={index+'-'+i}>{part.slice(1,-1)}</code>;
      return <span key={index+'-'+i}>{part}</span>;
    });
    return <p key={index}>{parts}</p>;
  });
}

function drawProjectPreview(ctx:CanvasRenderingContext2D, project:Project, frame:number) {
  ctx.fillStyle='#0e0b17';
  ctx.fillRect(0,0,1100,650);
  ctx.fillStyle='#171226';
  ctx.fillRect(24,24,1052,78);
  ctx.fillStyle='#2a203e';
  ctx.fillRect(24,122,1052,1);
  ctx.font='700 28px Inter, sans-serif';
  ctx.fillStyle='#fff';
  ctx.fillText(project.icon+'  '+project.name,48,62);
  ctx.font='500 15px Inter, sans-serif';
  ctx.fillStyle='#aaa0bd';
  ctx.fillText('Referencia visual del proyecto · no sustituye una fuente LIVE verificada',48,87);
  const pulse=(frame%4)/3;
  ctx.fillStyle='rgba(159,124,255,'+(0.12+0.12*pulse)+')';
  ctx.beginPath(); ctx.arc(1000,63,10+4*pulse,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#d7cfff';
  ctx.font='700 12px Inter, sans-serif';
  ctx.fillText('PROJECT REFERENCE',900,92);

  const projectCards:Record<string,{label:string,value:string}[]>={
    battlecruiser:[
      {label:'Estado',value:'Operativo'},
      {label:'Contexto',value:'Operación'},
      {label:'Misiones',value:'—'},
      {label:'Conversación',value:'Disponible'}
    ],
    cuevacoin:[
      {label:'Estado',value:'Operativo'},
      {label:'Contexto',value:'Finanzas'},
      {label:'Cuenta',value:'Protegida'},
      {label:'Movimientos',value:'—'}
    ],
    aria:[
      {label:'Estado',value:'LIVE'},
      {label:'Contexto',value:'Cerebro'},
      {label:'Misiones',value:'Canónica'},
      {label:'Evidencia',value:'Gobernada'}
    ]
  };
  const cards=projectCards[project.id]||projectCards.aria;
  cards.forEach((card,i)=>{
    const x=24+i*264;
    ctx.fillStyle='#151020'; ctx.fillRect(x,142,246,88);
    ctx.strokeStyle='#2d2540'; ctx.strokeRect(x,142,246,88);
    ctx.font='600 12px Inter, sans-serif'; ctx.fillStyle='#8d839f'; ctx.fillText(card.label,x+16,167);
    ctx.font='800 22px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText(card.value,x+16,201);
  });

  ctx.fillStyle='#151020'; ctx.fillRect(24,248,1052,280);
  ctx.strokeStyle='#2d2540'; ctx.strokeRect(24,248,1052,280);
  ctx.font='700 14px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText('Área de referencia del proyecto',48,278);
  ctx.font='500 13px Inter, sans-serif'; ctx.fillStyle='#9187a3';
  const contextLines=project.id==='cuevacoin'
    ? ['Panel financiero/operativo de referencia para CuevaCoin.','Cuenta, movimientos, transferencias y operaciones se muestran como referencia para señalar cambios.','Las operaciones financieras reales requieren backend LIVE y verificación específica.']
    : project.id==='aria'
    ? ['Centro cognitivo de referencia para ARIA.','Misiones, ejecución, verificación, evidencia y capacidades pertenecen al runtime canónico.','Los estados deben proceder de evidencia LIVE y persistida, no de texto inventado.']
    : [project.context,'Chat, misiones y ARTIA comparten el mismo proyecto y la misma cola canónica de ARIA.','La referencia visual sirve para señalar cambios y no certifica por sí sola una ejecución LIVE.'];
  contextLines.forEach((line,i)=>ctx.fillText(line.slice(0,115),48,309+i*26));
  const rows=project.id==='cuevacoin'
    ? [['Resumen','Balance y contexto principal'],['Chat','Conversación exclusiva de CuevaCoin'],['Misiones','Trabajo, seguimiento y evidencia'],['ARTIA','Referencia visual + anotación']]
    : project.id==='aria'
    ? [['Resumen','Estado cognitivo y fuentes'],['Chat','Conversación con ARIA'],['Misiones','Ejecución y verificación'],['ARTIA','Referencia visual + anotación']]
    : [['Resumen','Estado y contexto principal'],['Chat','Conversación exclusiva del proyecto'],['Misiones','Trabajo, seguimiento y evidencia'],['ARTIA','Referencia visual + anotación']];
  rows.forEach((row,i)=>{
    const y=390+i*31;
    ctx.fillStyle=i===3?'#30225c':'#1b152a'; ctx.fillRect(48,y,1004,23);
    ctx.fillStyle=i===3?'#e4dcff':'#b8aec8'; ctx.font='700 11px Inter, sans-serif'; ctx.fillText(row[0],62,y+16);
    ctx.font='500 11px Inter, sans-serif'; ctx.fillText(row[1],190,y+16);
  });
  ctx.fillStyle='#0f0b17'; ctx.fillRect(24,548,1052,62);
  ctx.fillStyle='#9f7cff'; ctx.fillRect(24,548,Math.max(120,240+frame*90),4);
  ctx.fillStyle='#7f7590'; ctx.font='500 12px Inter, sans-serif'; ctx.fillText('Pausa la referencia para anotar sobre el proyecto.',48,585);
}

function ProjectOverviewPreview({project}:{project:Project}) {
  const [loadState,setLoadState]=useState<'loading'|'loaded'|'failed'>('loading');
  useEffect(()=>setLoadState('loading'),[project.id,project.previewUrl]);
  const previewUrl=project.previewUrl||'';
  const mode=project.previewMode||(previewUrl?'live':'reference');
  return <section className='panel projectOverviewPreview' aria-label={'Previsualización de '+project.name} data-project-id={project.id} data-preview-mode={mode}>
    <div className='panelHeading'>
      <div><div className='panelTitle'>PREVISUALIZACIÓN · {project.name.toUpperCase()}</div><h2>Así se ve el proyecto</h2><p className='muted'>Esta vista cambia con el proyecto seleccionado. Para dibujar instrucciones y crear una misión usa ARTIA.</p></div>
      <span className={'pill '+(loadState==='failed'?'bad':loadState==='loaded'?(mode==='live'?'good':'neutral'):'live')}>
        {loadState==='failed'?'No disponible':loadState==='loaded'?(mode==='live'?'LIVE cargada':mode==='auth-required'?'LIVE · acceso requerido':'Código real cargado'):'Cargando…'}
      </span>
    </div>
    <div className='projectOverviewPreviewFrame'>
      {previewUrl
        ? <iframe key={project.id+'|'+previewUrl} title={'Previsualización '+project.name} src={previewUrl} allow='fullscreen' onLoad={()=>setLoadState('loaded')} onError={()=>setLoadState('failed')} />
        : <div className='emptyState'>No hay fuente de previsualización configurada para {project.name}.</div>}
      {mode==='auth-required' && <div className='projectReferenceBadge' role='note'>FUENTE LIVE · REQUIERE SESIÓN · DASHBOARD NO VERIFICADO</div>}
      {mode==='source' && <div className='projectReferenceBadge' role='note'>REFERENCIA VISUAL · ESTRUCTURA REAL · NO LIVE</div>}
      {mode==='reference' && <div className='projectReferenceBadge' role='note'>REFERENCIA VISUAL · NO ES LIVE</div>}
    </div>
    <div className='projectOverviewPreviewMeta'>
      <span>{mode==='live'?'Fuente LIVE del proyecto':mode==='auth-required'?'Fuente LIVE protegida; la sesión es requisito para ver el contenido interno.':mode==='source'?'Referencia visual basada en la estructura real del proyecto; datos LIVE no disponibles':'Referencia visual sin fuente LIVE'}</span>
      <span>{loadState!=='loaded'?'Se está comprobando la superficie…':mode==='auth-required'?'La URL respondió, pero el dashboard privado no se considera verificado.':'La superficie configurada cargó.'}</span>
    </div>
  </section>;
}


type ProjectConnectionCheck = {
  status?: string;
  http_status?: number | null;
  version?: string | null;
  service?: string | null;
  verified?: boolean;
  note?: string;
};
type ProjectConnectionReport = {
  ok?: boolean;
  project_id?: string;
  client_config?: BattleCruiserClientConfig | null;
  checks?: {
    frontend?: ProjectConnectionCheck;
    backend_auth?: ProjectConnectionCheck;
    backend_data?: ProjectConnectionCheck;
    repository?: ProjectConnectionCheck & { url?: string };
  };
};
type BattleCruiserVerifiedConnection = {
  user:{id:string;email:string|null};
  checks?:{
    auth_user?:ProjectConnectionCheck;
    profile_rpc?:ProjectConnectionCheck;
    permissions_rpc?:ProjectConnectionCheck;
    backend_data?:ProjectConnectionCheck;
  };
};

function ProjectResourceConnections({project,session}:{project:Project;session:Session}) {
  const [report,setReport]=useState<ProjectConnectionReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [connectionError,setConnectionError]=useState('');
  const [connectionNotice,setConnectionNotice]=useState('');
  const [connecting,setConnecting]=useState(false);
  const [bcUsername,setBcUsername]=useState('');
  const [bcPassword,setBcPassword]=useState('');
  const [connectedUser,setConnectedUser]=useState<BattleCruiserVerifiedConnection|null>(()=>activeBattleCruiserConnection?.ariaUserId===session.userId?{user:activeBattleCruiserConnection.user,checks:activeBattleCruiserConnection.verifiedChecks}:null);
  const [refreshTick,setRefreshTick]=useState(0);

  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    api('/projects/'+encodeURIComponent(project.id)+'/connections',session.accessToken)
      .then(value=>{if(active)setReport(value as ProjectConnectionReport)})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo comprobar la conexión.')})
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[project.id,session.accessToken,refreshTick]);

  async function connectBattleCruiserAccount(){
    setConnecting(true);setConnectionError('');setConnectionNotice('');
    const email=bcUsername.trim();
    const password=bcPassword;
    try{
      const config=report?.client_config;
      if(!config?.supabase_url||!config.publishable_key)throw new Error('El backend de BattleCruiser aún no publicó una configuración pública válida.');
      if(!email||!password)throw new Error('Escribe el correo y la contraseña de BattleCruiser.');
      if(!email.includes('@'))throw new Error('La búsqueda por nombre de usuario está restringida por los permisos actuales de BattleCruiser. Introduce el correo asociado a tu cuenta.');
      const authResponse=await fetch(config.supabase_url+'/auth/v1/token?grant_type=password',{
        method:'POST',
        headers:{apikey:config.publishable_key,'content-type':'application/json'},
        body:JSON.stringify({email,password}),
        cache:'no-store'
      });
      const authData:any=await authResponse.json().catch(()=>null);
      if(!authResponse.ok||!authData?.access_token||!authData?.refresh_token)throw new Error('BattleCruiser rechazó las credenciales. Verifica el usuario y la contraseña.');
      const verification=await api('/projects/battlecruiser/connections/verify',session.accessToken,{
        method:'POST',
        headers:{'x-battlecruiser-access-token':String(authData.access_token)},
        body:JSON.stringify({})
      });
      if(verification?.ok!==true||verification?.authenticated!==true||!verification?.user?.id)throw new Error('No se pudo verificar la sesión autenticada de BattleCruiser.');
      const connection:ActiveBattleCruiserConnection={
        ariaUserId:session.userId,
        accessToken:String(authData.access_token),
        refreshToken:String(authData.refresh_token),
        expiresAt:Date.now()+Math.max(60,Number(authData.expires_in)||3600)*1000,
        user:{id:String(verification.user.id),email:typeof verification.user.email==='string'?verification.user.email:null},
        clientConfig:config,
        verifiedChecks:verification.checks
      };
      activeBattleCruiserConnection=connection;
      setConnectedUser({user:connection.user,checks:verification.checks});
      setBcPassword('');
      setConnectionError('');
      setRefreshTick(v=>v+1);
    }catch(e){
      setConnectionError(e instanceof Error?e.message:'No se pudo conectar al backend de BattleCruiser.');
    }finally{
      setBcPassword('');
      setConnecting(false);
    }
  }

  function disconnectBattleCruiser(){
    activeBattleCruiserConnection=null;
    setConnectedUser(null);
    setConnectionError('');
    setConnectionNotice('Se cerró la conexión de BattleCruiser dentro de esta pestaña. La sesión de ARIA sigue intacta.');
  }

  const frontend=report?.checks?.frontend;
  const auth=report?.checks?.backend_auth;
  const data=report?.checks?.backend_data;
  const repository=report?.checks?.repository;
  const statusText=(value?:string)=>{
    const map:Record<string,string>={
      reachable:'Disponible',unavailable:'No responde',healthy:'Auth saludable',
      frontend_backend_config_mismatch:'Configuración no coincide',
      public_api_key_not_found:'Clave pública no encontrada',
      public_api_key_not_found_or_not_publishable:'Clave pública no válida',
      not_checked_requires_authenticated_context:'Protegido · falta validar sesión',
      authenticated_rpc_access_verified:'Sesión y RPC de lectura verificadas',
      authenticated_session_verified_rpc_access_limited:'Sesión válida · RPC limitado',
      configured_not_verified_by_runtime:'Enlace listo · acceso no verificado',
      not_configured:'Sin configurar',verified:'Verificada',available:'Disponible',
      not_available_for_this_session:'No disponible para este usuario'
    };
    return value?(map[value]||value):'Pendiente';
  };
  const statusClass=(value?:string)=>value==='reachable'||value==='healthy'||value==='authenticated_rpc_access_verified'?'good':value==='unavailable'||value==='frontend_backend_config_mismatch'?'bad':'neutral';

  return <section className='panel projectResourceConnections' aria-label={'Fuentes canónicas de '+project.name}>
    <div className='panelHeading'>
      <div><div className='panelTitle'>FUENTES CANÓNICAS · {project.name.toUpperCase()}</div><h2>Conexiones del proyecto</h2><p className='muted'>Código, frontend LIVE y backend propio. ARIA conserva separado su Supabase.</p></div>
      <button type='button' className='ghost' disabled={loading} onClick={()=>setRefreshTick(v=>v+1)}>{loading?'Comprobando…':'Comprobar de nuevo ↻'}</button>
    </div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
      <a className='ghost' href='https://battlecruiser.robvg9.workers.dev/' target='_blank' rel='noreferrer' style={{display:'inline-flex',alignItems:'center',textDecoration:'none'}}>Frontend LIVE ↗</a>
      <a className='ghost' href='https://github.com/Robvg9/battlecruiser/tree/main' target='_blank' rel='noreferrer' style={{display:'inline-flex',alignItems:'center',textDecoration:'none'}}>Código · main ↗</a>
      <a className='ghost' href='https://supabase.com/dashboard/project/papxnkkjtkxsitcsvcme' target='_blank' rel='noreferrer' style={{display:'inline-flex',alignItems:'center',textDecoration:'none'}}>Backend · Supabase ↗</a>
    </div>
    <div className='statsGrid' style={{marginTop:14}}>
      <div className='statCard'><div className='statLabel'>FRONTEND LIVE</div><div className='statValue' style={{fontSize:16}}>{statusText(frontend?.status)}</div><div className='muted'>{frontend?.version?'Versión '+frontend.version:frontend?.http_status?'HTTP '+frontend.http_status:'app.js'}</div></div>
      <div className='statCard'><div className='statLabel'>BACKEND AUTH</div><div className='statValue' style={{fontSize:16}}>{statusText(auth?.status)}</div><div className='muted'>{auth?.service?(auth.service+(auth.version?' · '+auth.version:'')):auth?.http_status?'HTTP '+auth.http_status:'Identidad Supabase del proyecto'}</div></div>
      <div className='statCard'><div className='statLabel'>DATOS PROTEGIDOS</div><div className='statValue' style={{fontSize:16}}>{connectedUser?statusText(connectedUser.checks?.backend_data?.status):statusText(data?.status)}</div><div className='muted'>{connectedUser?'Usuario autenticado: '+(connectedUser.user.email||connectedUser.user.id):'No se prueba sin una sesión BC autorizada.'}</div></div>
      <div className='statCard'><div className='statLabel'>GITHUB SOURCE</div><div className='statValue' style={{fontSize:16}}>{statusText(repository?.status)}</div><div className='muted'>El enlace existe; el runtime aún no certifica autorización Git.</div></div>
    </div>
    <section style={{marginTop:16,padding:14,border:'1px solid var(--border, #39464f)',borderRadius:10}}>
      <div className='panelTitle'>CONECTAR SESIÓN AUTENTICADA DE BATTLECRUISER</div>
      {connectedUser?<div style={{display:'grid',gap:8,marginTop:10}}>
        <p className='muted'>Sesión verificada como <strong>{connectedUser.user.email||connectedUser.user.id}</strong>. La conexión está en memoria de esta pestaña; no se guardó la contraseña ni el token en el almacenamiento persistente.</p>
        <div className='muted'>Perfil RPC: {statusText(connectedUser.checks?.profile_rpc?.status)} · Permisos RPC: {statusText(connectedUser.checks?.permissions_rpc?.status)}</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button type='button' className='ghost' onClick={()=>setRefreshTick(v=>v+1)}>Actualizar salud ↻</button>
          <button type='button' className='ghost' onClick={disconnectBattleCruiser}>Cerrar conexión BC</button>
        </div>
      </div>:<form onSubmit={event=>{event.preventDefault();void connectBattleCruiserAccount();}} style={{display:'grid',gap:10,marginTop:10,maxWidth:460}}>
        <label style={{display:'grid',gap:5}}>Correo electrónico de BattleCruiser
          <input type='email' value={bcUsername} onChange={event=>setBcUsername(event.target.value)} autoComplete='username' disabled={connecting} placeholder='correo@ejemplo.com' required />
        </label>
        <label style={{display:'grid',gap:5}}>Contraseña de BattleCruiser
          <input value={bcPassword} onChange={event=>setBcPassword(event.target.value)} type='password' autoComplete='current-password' disabled={connecting} placeholder='Se envía directamente a Supabase BattleCruiser' required />
        </label>
        <p className='muted'>Usa el correo asociado a tu cuenta: el backend actual restringe la búsqueda pública por nombre de usuario. La contraseña se envía desde este navegador directamente al Auth de BattleCruiser; no pasa por el API de ARIA. El token solo queda en memoria y nunca concede permisos administrativos.</p>
        <button type='submit' className='primary' disabled={connecting||loading||!report?.client_config}>{connecting?'Conectando…':'Conectar backend BattleCruiser'}</button>
      </form>}
      {connectionError&&<p className='notice' role='alert' style={{marginTop:10}}>{connectionError}</p>}{connectionNotice&&<p className='muted' role='status' style={{marginTop:10}}>{connectionNotice}</p>}
    </section>
    {error&&<p className='notice' role='status'>{error}</p>}
    {!report&&!loading&&!error&&<p className='muted'>Aún no hay resultado de verificación.</p>}
    <p className='muted' style={{marginTop:12}}>La conexión utiliza el JWT del usuario autenticado y sus permisos/RLS; no eleva privilegios, no cambia datos y no abre permisos anónimos.</p>
  </section>;
}

function VisualBoard({session,project,conversationId,onChat,onMission}:{session:Session;project:Project;conversationId:string|null;onChat:(message:string,conversationId?:string)=>void;onMission:(payload:any)=>Promise<any>}) {
  const livePreviewUrl = project.previewUrl || null;
  const previewMode = project.previewMode || (livePreviewUrl ? 'live' : 'reference');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool,setTool] = useState<Tool>('pen');
  const [color,setColor] = useState('#9f7cff');
  const [size,setSize] = useState(6);
  const [instruction,setInstruction] = useState('');
  const [actions,setActions] = useState<DrawAction[]>([]);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [backgroundDataUrl,setBackgroundDataUrl] = useState<string|null>(null);
  const [previewPaused,setPreviewPaused] = useState(false);
  const [previewFrame,setPreviewFrame] = useState(0);
  const [previewFullscreen,setPreviewFullscreen] = useState(false);
  const previewShellRef = useRef<HTMLDivElement>(null);
  const backgroundImage = useRef<HTMLImageElement|null>(null);
  const drawing = useRef(false);
  const startPoint = useRef<Point|null>(null);
  const drawingActionRef = useRef<number|null>(null);
  const drawingPointsRef = useRef<Point[]>([]);

  const drawOne = (ctx:CanvasRenderingContext2D,a:DrawAction) => {
    if (!a.points.length) return;
    const p=a.points[0], q=a.points[a.points.length-1] || p;
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=a.tool==='eraser'?'#0e0b17':a.color; ctx.fillStyle=a.color; ctx.lineWidth=a.size;
    if (a.tool==='pen'||a.tool==='marker'||a.tool==='eraser') {
      ctx.globalAlpha=a.tool==='marker'?0.45:1; ctx.beginPath();
      a.points.forEach((pt,i)=>i?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y)); ctx.stroke(); ctx.globalAlpha=1; return;
    }
    if (a.tool==='line') { ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();return; }
    if (a.tool==='rect') { ctx.strokeRect(p.x,p.y,q.x-p.x,q.y-p.y);return; }
    if (a.tool==='circle') { const rx=Math.abs(q.x-p.x)/2,ry=Math.abs(q.y-p.y)/2,cx=(p.x+q.x)/2,cy=(p.y+q.y)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(2,rx),Math.max(2,ry),0,0,Math.PI*2);ctx.stroke();return; }
    if (a.tool==='arrow') { const ang=Math.atan2(q.y-p.y,q.x-p.x),head=Math.max(12,a.size*3);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-head*Math.cos(ang-Math.PI/6),q.y-head*Math.sin(ang-Math.PI/6));ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-head*Math.cos(ang+Math.PI/6),q.y-head*Math.sin(ang+Math.PI/6));ctx.stroke();return; }
    if (a.tool==='text' && a.text) { ctx.font='700 22px Inter, sans-serif';ctx.fillText(a.text,p.x,p.y); }
  };

  const redraw = () => {
    const c=canvasRef.current; if(!c)return; const d=window.devicePixelRatio||1; const ctx=c.getContext('2d'); if(!ctx)return;
    ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,1100,650);
    // A configured previewUrl belongs to the real project surface and is rendered by
    // the iframe below. The canvas must remain transparent so it cannot hide that source.
    if(!livePreviewUrl){
      if(backgroundImage.current?.complete&&backgroundImage.current.naturalWidth){
        const img=backgroundImage.current;const scale=Math.min(1100/img.naturalWidth,650/img.naturalHeight);const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
        ctx.fillStyle='#0e0b17';ctx.fillRect(0,0,1100,650);ctx.drawImage(img,(1100-w)/2,(650-h)/2,w,h);
      } else {
        drawProjectPreview(ctx,project,previewFrame);
      }
    }
    if(previewPaused){
      // Keep the reference/live project visible underneath while adding a subtle
      // annotation grid only when the user explicitly paused the surface.
      ctx.globalAlpha=1;ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
      for(let x=0;x<=1100;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,650);ctx.stroke();}
      for(let y=0;y<=650;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1100,y);ctx.stroke();}
      actions.forEach(a=>drawOne(ctx,a));
    }
  };

  useEffect(()=>{const c=canvasRef.current;if(!c)return;const d=window.devicePixelRatio||1;c.width=1100*d;c.height=650*d;redraw();const f=()=>{const dpr=window.devicePixelRatio||1;c.width=1100*dpr;c.height=650*dpr;redraw()};window.addEventListener('resize',f);return()=>window.removeEventListener('resize',f)},[]);
  useEffect(()=>redraw(),[actions,backgroundDataUrl,previewPaused,previewFrame,project.id,livePreviewUrl]);
  useEffect(()=>{if(previewPaused)return;const timer=window.setInterval(()=>setPreviewFrame(v=>(v+1)%4),1200);return()=>window.clearInterval(timer)},[previewPaused]);
  useEffect(()=>{
    setActions([]);
    setInstruction('');
    setBusy(false);
    setNotice('');
    setBackgroundDataUrl(null);
    setPreviewPaused(false);
    setPreviewFrame(0);
    setPreviewFullscreen(false);
    backgroundImage.current=null;
    drawing.current=false;
    startPoint.current=null;
    drawingActionRef.current=null;
    drawingPointsRef.current=[];
  },[project.id]);

  useEffect(()=>{
    const onFullscreenChange=()=>setPreviewFullscreen(document.fullscreenElement===previewShellRef.current);
    document.addEventListener('fullscreenchange',onFullscreenChange);
    return()=>document.removeEventListener('fullscreenchange',onFullscreenChange);
  },[]);

  async function togglePreviewFullscreen(){
    try{
      if(document.fullscreenElement===previewShellRef.current){await document.exitFullscreen();return;}
      if(!previewShellRef.current)throw new Error('Vista previa no disponible.');
      await previewShellRef.current.requestFullscreen();
    }catch(e){
      setNotice(e instanceof Error?e.message:'El navegador no permitió pantalla completa.');
    }
  }

  function loadBackground(file:File){
    if(!file.type.startsWith('image/')){setNotice('La base visual debe ser una imagen.');return;}
    const reader=new FileReader();
    reader.onload=()=>{const src=String(reader.result||'');const img=new Image();img.onload=()=>{backgroundImage.current=img;setBackgroundDataUrl(src);setPreviewPaused(true);setNotice('Captura/base visual cargada y pausada. Ahora puedes anotar encima.')};img.src=src};
    reader.readAsDataURL(file);
  }

  const pointFromEvent=(e:React.PointerEvent)=>{const c=canvasRef.current;if(!c)return null;const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*1100/r.width,y:(e.clientY-r.top)*650/r.height}};
  const pointerDown=(e:React.PointerEvent)=>{
    if(!previewPaused){setNotice('Pausa la vista previa antes de pintar.');return;}
    const p=pointFromEvent(e);if(!p)return;canvasRef.current?.setPointerCapture(e.pointerId);drawing.current=true;startPoint.current=p;drawingPointsRef.current=[p];
    if(tool==='text'){const text=instruction.trim();if(text)setActions(a=>[...a,{tool:'text',color,size,points:[p],text:text.slice(0,120)}]);else setNotice('Escribe primero el texto que quieras colocar sobre la vista.');drawing.current=false;drawingActionRef.current=null;return;}
    setActions(a=>{drawingActionRef.current=a.length;return [...a,{tool,color,size,points:[p]}]});
  };
  const pointerMove=(e:React.PointerEvent)=>{
    if(!drawing.current||!previewPaused)return;
    const p=pointFromEvent(e);if(!p)return;
    drawingPointsRef.current.push(p);
    const points=['pen','marker','eraser'].includes(tool)?[...drawingPointsRef.current]:[startPoint.current||p,p];
    setActions(a=>{
      const index=drawingActionRef.current;
      if(index==null||!a[index])return a;
      const next=[...a];next[index]={...next[index],points};return next;
    });
  };
  const pointerUp=()=>{
    if(drawing.current){
      const points=drawingPointsRef.current.length?drawingPointsRef.current:[startPoint.current!];
      setActions(a=>{
        const index=drawingActionRef.current;
        if(index==null||!a[index])return a;
        const next=[...a];
        next[index]={...next[index],points:['pen','marker','eraser'].includes(tool)?points:[points[0],points[points.length-1]||points[0]]};
        return next;
      });
    }
    drawing.current=false;startPoint.current=null;drawingActionRef.current=null;drawingPointsRef.current=[];
  };
  const annotationSummary=useMemo(()=>actions.map((a,i)=>{const p=a.points[0],q=a.points[a.points.length-1]||p;return '#'+(i+1)+' '+a.tool+' inicio=('+Math.round(p.x)+','+Math.round(p.y)+') fin=('+Math.round(q.x)+','+Math.round(q.y)+') color='+a.color+' tamaño='+a.size+(a.text?' texto="'+a.text+'"':'')}).join('; ')||'ninguna',[actions]);

  async function send(createMission:boolean){
    if(busy)return;
    if(!previewPaused){setNotice('Pausa la vista previa antes de enviar una anotación a ARIA.');return;}
    setBusy(true);setNotice('');
    try{
      const c=canvasRef.current;if(!c)throw new Error('Lienzo no disponible.');
      const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('No se pudo exportar el diseño.')),'image/png'));
      const up=await api('/media/upload-url',session.accessToken,{method:'POST',body:JSON.stringify({fileName:project.id+'-visual.png',contentType:'image/png'})});
      const signed=up?.signedUrl??up?.upload?.signed_url;const path=up?.path??up?.upload?.path;
      if(!signed||!path)throw new Error('ARIA no confirmó la ubicación del diseño.');
      const put=await fetch(signed,{method:'PUT',headers:{'content-type':'image/png'},body:blob});if(!put.ok)throw new Error('No se pudo guardar el diseño.');
      const visualContext={project_preview:true,preview_paused:true,preview_url:livePreviewUrl,preview_mode:previewMode,instruction:instruction.trim(),annotation_summary:'Proyecto='+project.name+'. Fuente de previsualización='+previewMode+'. La vista está pausada para anotar. Lienzo 1100x650. Anotaciones: '+annotationSummary+'.',annotations:actions.slice(0,128).map(a=>({tool:a.tool,color:a.color,size:a.size,points:a.points.slice(0,512).map(pt=>({x:Math.round(pt.x*100)/100,y:Math.round(pt.y*100)/100})),text:a.text??null})),image_path:path,mime_type:'image/png'};
      const text='TRABAJO VISUAL DE PROYECTO. Proyecto: '+project.name+'. Fuente de previsualización: '+(livePreviewUrl||'no configurada')+' · modo='+previewMode+'. El usuario pausó la superficie visual y realizó estas anotaciones: '+annotationSummary+'. INSTRUCCIÓN DEL USUARIO: '+(instruction.trim()||'Interpreta las anotaciones como instrucciones exactas y pregunta solo si algo es realmente ambiguo.')+'\\n\\nVISUAL_CONTEXT:\\n'+visualContext.annotation_summary;
      const activeConversationId=conversationId||crypto.randomUUID();
      if(createMission){const result=await onMission({goal:text,visual_context:visualContext});if(result!==true)throw new Error('ARIA no confirmó la creación de la misión. Revisa el error del proyecto antes de volver a intentarlo.');setNotice('Misión confirmada por ARIA con el diseño y las anotaciones.')}
      else{const parts:any[]=[{type:'text',text},{type:'file',fileId:path,path,mimeType:'image/png',filename:project.id+'-visual.png'}]; const response=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts,clientMessageId:crypto.randomUUID(),conversationId:activeConversationId,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:visualContext})});const reply=response.parts?.find((p:any)=>p.type==='text')?.text||'Diseño visual enviado a ARIA.';onChat(reply,activeConversationId);setNotice('Diseño enviado a ARIA en el chat exclusivo del proyecto.')}
    }catch(e){setNotice(e instanceof Error?e.message:'No se pudo enviar el diseño.')}finally{setBusy(false)}
  }

  return <section className='panel visualBoardPanel'>
    <div className='panelHeading'><div><div className='panelTitle'>ARTIA · PROJECT PREVIEW</div><h2>Vista previa de {project.name}</h2><div className='muted'>Mira el proyecto, pausa la vista cuando quieras modificar algo y pinta directamente sobre esa referencia.</div></div><span className={'pill '+(previewPaused?'good':previewMode==='live'?'live':'neutral')}>{previewMode==='live'?(previewPaused?'LIVE pausada · lista para pintar':'LIVE'):(previewMode==='auth-required'?(previewPaused?'Acceso pausado · se puede anotar':'LIVE · requiere sesión'):(previewMode==='source'?(previewPaused?'Referencia pausada · lista para pintar':'Referencia del proyecto'):(previewPaused?'Referencia pausada · lista para pintar':'Referencia visual')))}</span></div>
    <div className='visualPreviewControls'><div className='visualPreviewControlGroup'><button type='button' className='ghost' onClick={()=>{setPreviewPaused(v=>!v);if(!previewPaused)setNotice('Vista previa pausada. Ya puedes pintar.');else setNotice('Vista previa reanudada. Las nuevas anotaciones se conservan.')}}>{previewPaused?'▶ Reproducir vista':'⏸ Pausar para pintar'}</button><button type='button' className='ghost' onClick={()=>void togglePreviewFullscreen()} aria-label={previewFullscreen?'Salir de pantalla completa':'Abrir vista previa en pantalla completa'}>{previewFullscreen?'↙ Salir':'⛶ Pantalla completa'}</button></div><span className='muted'>{backgroundDataUrl?'Referencia cargada':previewMode==='live'?'Fuente LIVE configurada':previewMode==='auth-required'?'Fuente LIVE protegida; el dashboard no está verificado':previewMode==='source'?'Referencia visual basada en la estructura real del proyecto':'Referencia visual local del proyecto'}</span></div>
    <div className='drawToolbar'>
      <label className='fileButton'>📷 Cargar captura de referencia <input type='file' accept='image/*' hidden onChange={e=>{const f=e.target.files?.[0];if(f)loadBackground(f);e.currentTarget.value=''}}/></label>
      {(['pen','marker','line','rect','circle','arrow','text','eraser'] as Tool[]).map(x=><button type='button' key={x} className={'toolButton '+(tool===x?'selected':'')} onClick={()=>setTool(x)} aria-label={x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}>{x==='pen'?'✎':x==='marker'?'🖍':x==='line'?'╱':x==='rect'?'▭':x==='circle'?'◯':x==='arrow'?'➜':x==='text'?'T':'⌫'}<span>{x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}</span></button>)}
      <label>Color <input aria-label='Color del dibujo' type='color' value={color} onChange={e=>setColor(e.target.value)}/></label>
      <label>Grosor <input aria-label='Grosor del trazo' type='range' min='2' max='28' value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <button type='button' className='ghost' disabled={!previewPaused||!actions.length||busy} onClick={()=>setActions(a=>a.slice(0,-1))}>Deshacer</button>
      <button type='button' className='ghost' disabled={!previewPaused||!actions.length||busy} onClick={()=>setActions([])}>Limpiar</button>
    </div>
    <div ref={previewShellRef} className={'canvasWrap artiaPreviewShell '+(previewFullscreen?'isFullscreen':'')} style={{position:'relative',width:'100%',aspectRatio:'1100 / 650',overflow:'hidden'}}>
      {livePreviewUrl ? <iframe title={'Previsualización de '+project.name} src={livePreviewUrl} allow='fullscreen' style={{position:'absolute',inset:0,width:'100%',height:'100%',border:0,background:'#0e0b17',pointerEvents:previewPaused?'none':'auto'}} /> : null}
      <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:previewPaused?'auto':'none'}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label={'Capa de anotaciones visuales de '+project.name}/>
      {previewMode==='auth-required' && <div className='projectReferenceBadge' role='note'>LIVE · REQUIERE SESIÓN · DASHBOARD NO VERIFICADO</div>}{previewMode==='source' && <div className='projectReferenceBadge' role='note'>REFERENCIA VISUAL · CÓDIGO REAL · main · NO LIVE</div>}{previewMode==='reference' && <div className='projectReferenceBadge' role='note'>Referencia visual · sin fuente LIVE</div>}
      {previewFullscreen && <button type='button' className='artiaFullscreenExit' onClick={()=>void togglePreviewFullscreen()} aria-label='Salir de pantalla completa'>↙ Salir</button>}
    </div>
    <textarea className='visualInstruction' value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder='Describe qué debe cambiar. Lo escrito + lo pintado se convierten en contexto de ARIA y pueden saltar directamente como misión.'/><div className='muted visualHint'>Anotaciones: {actions.length} · {previewPaused?'La vista está pausada; las anotaciones quedan sobre la referencia.':'Pausa la vista para habilitar el lienzo.'}</div>
    {notice&&<div className='notice'>{notice}</div>}
    <div className='modalActions'><button className='ghost' disabled={busy||!previewPaused} onClick={()=>void send(false)}>Enviar a chat</button><button className='primary' disabled={busy||!previewPaused||(!instruction.trim()&&!actions.length)} onClick={()=>void send(true)}>Crear misión con este diseño</button></div>
  </section>;
}

// Projects certification baseline: the project workspace is validated against the exact deployed PWA SHA.
// Projects certification trigger: final RWHT must execute against the exact main PWA build.

export function ProjectWorkspace({session,onBack}:{session:Session;onBack:()=>void}) {
  useEffect(()=>()=>{if(activeBattleCruiserConnection?.ariaUserId===session.userId)activeBattleCruiserConnection=null;},[session.userId]);
  const PROJECT_KEY='aria_project_selection_v2:'+session.userId;
  const TAB_KEY=(projectId:string)=>'aria_project_tab_v2:'+session.userId+':'+projectId;
  const [project,setProject]=useState<Project>(()=>{try{const id=localStorage.getItem(PROJECT_KEY);return PROJECTS.find(p=>p.id===id)||PROJECTS[0]}catch{return PROJECTS[0]}});
  const [tab,setTab]=useState<'overview'|'chat'|'missions'|'visual'>(()=>{try{const saved=localStorage.getItem(TAB_KEY(PROJECTS[0].id));return (saved as any)||'overview'}catch{return 'overview'}});
  const [messages,setMessages]=useState<ChatMessage[]>(()=>{
    try {
      const cached=localStorage.getItem('aria_project_conversation:'+session.userId+':'+PROJECTS[0].id);
      const data=cached?JSON.parse(cached):null;
      return Array.isArray(data?.messages)?data.messages:[];
    } catch { return []; }
  });
  const processingStartedAtRef=useRef<number|null>(null);
  const [processingElapsedMs,setProcessingElapsedMs]=useState(0);
  const [lastProcessingMs,setLastProcessingMs]=useState<number|null>(null);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [projectChatReady,setProjectChatReady]=useState(false);
  const [text,setText]=useState('');
  const [goal,setGoal]=useState('');
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [missions,setMissions]=useState<any[]>(()=>{
    try { return JSON.parse(localStorage.getItem('aria_project_missions:'+session.userId+':'+PROJECTS[0].id)||'[]'); } catch { return []; }
  });
  const [selectedMission,setSelectedMission]=useState<any|null>(null);
  const projectChatRef=useRef<HTMLTextAreaElement|null>(null);
  const projectChatLoadRef=useRef<{projectId:string;promise:Promise<void>}|null>(null);
  const projectChatReadGenerationRef=useRef(0);
  const projectChatWriteInFlightRef=useRef(false);
  // Retain an uncertain request identity across retries; API v3 reconciles it before calling DIRECT again.
  const createMissionRequestRef=useRef<{key:string;requestId:string}|null>(null);

  useEffect(()=>{try{localStorage.setItem(PROJECT_KEY,project.id);localStorage.setItem(TAB_KEY(project.id),tab)}catch{}},[project.id,tab,session.userId]);

  async function loadMissions(){
    try{
      const d=await api('/projects/'+encodeURIComponent(project.id)+'/missions?limit=20',session.accessToken);
      const rows=Array.isArray(d?.missions)?d.missions:[];
      setMissions(rows);
      try{localStorage.setItem('aria_project_missions:'+session.userId+':'+project.id,JSON.stringify(rows));}catch{}
    }catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar las misiones.')}
  }

  async function loadProjectChat(options:{quiet?:boolean}={}){
    const projectId=project.id;
    const existing=projectChatLoadRef.current;
    if(existing?.projectId===projectId)return existing.promise;
    const readGeneration=++projectChatReadGenerationRef.current;
    setProjectChatReady(false);
    const promise=(async()=>{
      try{
        const d=await api('/projects/'+encodeURIComponent(projectId)+'/conversation',session.accessToken);
        // A read started before a write or a project switch must not overwrite newer chat state.
        if(projectId!==project.id||readGeneration!==projectChatReadGenerationRef.current)return;
        if(!d?.conversation_id)throw new Error('ARIA no confirmó la conversación del proyecto.');
        const rows=Array.isArray(d.conversation?.messages)?d.conversation.messages:[];
        const normalized=rows.map((m:any)=>({id:String(m.message_id),role:m.role==='assistant'?'aria':'user',text:String(m.content||'')})).filter((m:any)=>m.text.trim());
        setConversationId(d.conversation_id);
        setMessages(normalized);
        setError('');
        try{localStorage.setItem('aria_project_conversation:'+session.userId+':'+projectId,JSON.stringify({conversation_id:d.conversation_id,messages:normalized}));}catch{}
        setProjectChatReady(true);
      }catch(e){
        // A slow initial read can finish after the user sends a message. Ignore its
        // error rather than surfacing a stale failure over the newer write/poll cycle.
        if(projectId===project.id&&readGeneration===projectChatReadGenerationRef.current){
          setProjectChatReady(true);
          // After a verified response, this final refresh is best-effort; do not
          // overwrite the successful server result with a secondary read timeout.
          if(!options.quiet&&!projectChatWriteInFlightRef.current)setError(e instanceof Error?e.message:'No se pudo cargar el chat del proyecto.');
        }
      }finally{
        if(projectChatLoadRef.current?.promise===promise)projectChatLoadRef.current=null;
      }
    })();
    projectChatLoadRef.current={projectId,promise};
    return promise;
  }

  async function waitForProjectAssistant(requestProject:Project, timeoutMs=120000){
    const deadline=Date.now()+timeoutMs;
    let delayMs=1500;
    while(Date.now()<deadline){
      try{
        const d=await api('/projects/'+encodeURIComponent(requestProject.id)+'/conversation',session.accessToken);
        const rows=Array.isArray(d?.conversation?.messages)?d.conversation.messages:[];
        if(d?.conversation_id&&rows.length){
          const normalized=rows
            .map((m:any)=>({id:String(m.message_id),role:m.role==='assistant'?'aria':'user',text:String(m.content||''),visualState:String(m.visual_state||''),providerId:String(m.provider_id||''),modelId:String(m.model_id||'')}))
            .filter((m:any)=>m.text.trim());
          const lastUserIndex=rows.reduce((last:number,m:any,index:number)=>m?.role==='user'?index:last,-1);
          const assistantAfterLatestUser=lastUserIndex>=0
            ? rows.slice(lastUserIndex+1).find((m:any)=>m?.role==='assistant'&&String(m?.content||'').trim().length>0)
            : null;
          try{localStorage.setItem('aria_project_conversation:'+session.userId+':'+requestProject.id,JSON.stringify({conversation_id:d.conversation_id,messages:normalized}));}catch{}
          if(assistantAfterLatestUser){
            if(requestProject.id===project.id){
              setConversationId(d.conversation_id);
              setMessages(normalized);
              if(String(assistantAfterLatestUser.visual_state||'')==='error') {
                setError(String(assistantAfterLatestUser.content||'ARIA no pudo completar esta respuesta.'));
              }
            }
            return String(assistantAfterLatestUser.visual_state||'')!=='error';
          }
        }
      }catch{
        // Transient read errors use bounded exponential backoff instead of creating more load.
      }
      await new Promise(resolve=>setTimeout(resolve,delayMs));
      delayMs=Math.min(6000,Math.round(delayMs*1.35));
    }
    return false;
  }

  useEffect(()=>{
    if(!sending){setProcessingElapsedMs(0);return;}
    const startedAt=processingStartedAtRef.current??Date.now();
    processingStartedAtRef.current=startedAt;
    const tick=()=>setProcessingElapsedMs(Date.now()-startedAt);
    tick();
    const timer=window.setInterval(tick,200);
    return()=>window.clearInterval(timer);
  },[sending]);

  useEffect(()=>{
    setSelectedMission(null);setError('');setProjectChatReady(false);
    try{
      const cachedM=JSON.parse(localStorage.getItem('aria_project_missions:'+session.userId+':'+project.id)||'[]');
      setMissions(Array.isArray(cachedM)?cachedM:[]);
      const cachedChat=JSON.parse(localStorage.getItem('aria_project_conversation:'+session.userId+':'+project.id)||'null');
      setConversationId(typeof cachedChat?.conversation_id==='string'?cachedChat.conversation_id:null);
      setMessages(Array.isArray(cachedChat?.messages)?cachedChat.messages:[]);
    }catch{setConversationId(null);setMessages([]);setMissions([]);}
    try{const saved=localStorage.getItem(TAB_KEY(project.id));if(saved)setTab(saved as any)}catch{}
  },[project.id,session.userId]);

  useEffect(()=>{
    if(tab==='missions'||tab==='overview')void loadMissions();
    if(tab==='chat'||tab==='visual')void loadProjectChat();
  },[project.id,tab,session.accessToken]);

  useEffect(()=>{
    const refresh=()=>{if(tab==='missions'||tab==='overview')void loadMissions()};
    const timer=window.setInterval(refresh,15000);
    return()=>window.clearInterval(timer);
  },[project.id,tab,session.accessToken]);

  useEffect(()=>{
    if(!selectedMission)return;
    const refresh=async()=>{try{const d=await api('/missions/'+encodeURIComponent(selectedMission.mission_id),session.accessToken);if(d?.mission)setSelectedMission(d.mission)}catch{}};
    const terminal=['succeeded','failed','blocked','cancelled'].includes(String(selectedMission.status));
    if(terminal)return;
    const timer=window.setInterval(()=>void refresh(),4000);void refresh();return()=>window.clearInterval(timer);
  },[selectedMission?.mission_id,session.accessToken]);

  function selectProject(next:Project){setProject(next);try{localStorage.setItem(PROJECT_KEY,next.id);const saved=localStorage.getItem(TAB_KEY(next.id));setTab((saved as any)||'overview')}catch{setTab('overview')}}

  function selectTab(next:'overview'|'chat'|'missions'|'visual'){setTab(next);try{localStorage.setItem(TAB_KEY(project.id),next)}catch{}}

  async function openMission(missionId:string){try{setError('');const d=await api('/missions/'+encodeURIComponent(missionId),session.accessToken);if(!d?.mission)throw new Error('No se pudo abrir el detalle de la misión.');setSelectedMission(d.mission)}catch(e){setError(e instanceof Error?e.message:'No se pudo abrir el detalle de la misión.')}}

  async function send(){
    const clean=text.trim();if(!clean||sending||projectChatWriteInFlightRef.current)return;
    projectChatWriteInFlightRef.current=true;
    const requestProject=project;
    const clientMessageId=crypto.randomUUID();
    projectChatReadGenerationRef.current+=1;
    projectChatLoadRef.current=null;
    setSending(true);setError('');processingStartedAtRef.current=Date.now();setProcessingElapsedMs(0);setLastProcessingMs(null);
    setMessages(m=>[...m,{id:crypto.randomUUID(),role:'user',text:clean}]);setText('');
    try{
      const id=conversationId||crypto.randomUUID();setConversationId(id);
      const d=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts:[{type:'text',text:clean}],clientMessageId,conversationId:id,project_id:requestProject.id,project:{id:requestProject.id,name:requestProject.name,context:requestProject.context}})});
      const p=d.parts?.find((x:any)=>x.type==='text');
      const serverProcessingMs=Number(d?.cognitive?.processing_ms);
      if(Number.isFinite(serverProcessingMs)&&serverProcessingMs>=0)setLastProcessingMs(serverProcessingMs);
      else if(processingStartedAtRef.current)setLastProcessingMs(Date.now()-processingStartedAtRef.current);
      if(d?.processing===true){
        // The local executor accepted an idempotent background job. Keep the user
        // informed and poll the canonical server conversation until its answer persists.
        setError('');
        const completed=await waitForProjectAssistant(requestProject,145000);
        if(!completed)throw new Error('ARIA aceptó el trabajo, pero la respuesta no quedó registrada dentro del límite de verificación.');
      }else if(p?.text){
        setMessages(m=>[...m,{id:crypto.randomUUID(),role:'aria',text:p.text,processingMs:Number.isFinite(serverProcessingMs)?serverProcessingMs:undefined}]);
      }
      if(d.mission?.mission_id)await loadMissions();
      await loadProjectChat({quiet:true});
    }catch(e){await loadProjectChat().catch(()=>{});setError(e instanceof Error?e.message:'No se pudo hablar con ARIA.')}finally{projectChatWriteInFlightRef.current=false;setSending(false)}
  }

  async function createMission(payload:any={}):Promise<boolean>{
    const clean=String(payload.goal??goal).trim();if(!clean||sending)return false;
    const visualContext=payload.visual_context||null;
    const requestKey=JSON.stringify({projectId:project.id,goal:clean,visual_context:visualContext});
    let request=createMissionRequestRef.current;
    if(!request||request.key!==requestKey){request={key:requestKey,requestId:crypto.randomUUID()};createMissionRequestRef.current=request;}
    setSending(true);setError('');
    try{
      const d=await api('/missions',session.accessToken,{method:'POST',headers:{'x-aria-request-id':request.requestId},body:JSON.stringify({goal:clean,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:visualContext})});
      // The canonical API exposes both mission.mission_id and top-level mission_id.
      // Normalize the documented response shapes instead of reporting a false failure
      // after DIRECT already persisted and even completed the mission.
      const createdMissionId=String(d?.mission?.mission_id??d?.mission_id??d?.result?.mission_id??'').trim();
      if(!createdMissionId){
        const detail=String(d?.detail??d?.error??d?.message??'respuesta sin identificador canónico').slice(0,180);
        throw new Error('ARIA no confirmó la creación de la misión ('+detail+').');
      }
      createMissionRequestRef.current=null;
      setGoal('');void loadMissions();setTimeout(()=>void loadMissions(),1200);
      return true;
    }catch(e){setError(e instanceof Error?e.message:'No se pudo crear la misión.');return false}finally{setSending(false)}
  }

  return <main className='appShell projectShell'>
    <section className='projectGrid' aria-label='Seleccionar proyecto'>{PROJECTS.map(p=><button type='button' key={p.id} className={'projectCard '+(p.id===project.id?'selected':'')} onClick={()=>selectProject(p)}><span className='projectIcon'>{p.icon}</span><div><strong>{p.name}</strong><small>{p.id==='battlecruiser'?'Operación':p.id==='cuevacoin'?'Finanzas':'Cerebro'}</small></div></button>)}</section>
    {tab!=='chat' && <section className='panel projectHero'><div><div className='eyebrow'>PROYECTO ACTUAL</div><h2>{project.icon} {project.name}</h2><p className='muted'>{project.context}</p></div></section>}
    {tab!=='chat'&&project.id==='battlecruiser'&&<ProjectResourceConnections project={project} session={session}/>}
    <div className='capTabs projectTabs' aria-label='Secciones del proyecto'>{(['overview','chat','missions','visual'] as const).map(t=><button type='button' key={t} className={'tabButton '+(tab===t?'selected':'')} onClick={()=>selectTab(t)}>{t==='overview'?'Resumen':t==='chat'?'Chat':t==='missions'?'Misiones':'ARTIA'}</button>)}</div>
    <div className='projectBodyViewport'>
      {error&&<div className='errorBox'>{error}</div>}
      {tab==='overview'&&<>
        <section className='panel realityBoardEntry' aria-label='ARIA Reality Board'>
          <div className='panelHeading'>
            <div><div className='panelTitle'>ESTADO GLOBAL</div><h2>¿Qué falta por cerrar?</h2><p className='muted'>Consulta fuentes actuales, versión LIVE, estado de misiones, verificaciones y las acciones que realmente faltan para ARIA, CuevaCoin y BattleCruiser.</p></div>
            <a className='ghost' href='/pwa/reality-board.html' target='_blank' rel='noreferrer' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',textDecoration:'none',whiteSpace:'nowrap'}}>Abrir Reality Board ↗</a>
          </div>
        </section>
        <section className='panel'><div className='panelTitle'>COLA COMPARTIDA</div><h2>Una sola cola, tres espacios de trabajo</h2><p className='muted'>Todo entra en el mismo planner, executor, verification y evidence fabric de ARIA. El proyecto añade contexto y filtrado, no un runtime paralelo.</p><div className='statsGrid'><div className='statCard'><div className='statValue violet'>{missions.length}</div><div className='statLabel'>Misiones</div></div><div className='statCard'><div className='statValue cyan'>{missions.filter(m=>['running','queued','planning','waiting','paused'].includes(String(m.status))).length}</div><div className='statLabel'>Activas / en cola</div></div><div className='statCard'><div className='statValue green'>{missions.filter(m=>String(m.status)==='succeeded').length}</div><div className='statLabel'>Completadas verificadas</div></div><div className='statCard'><div className='statValue gold'>{missions.filter(m=>['blocked','failed'].includes(String(m.status))).length}</div><div className='statLabel'>Requieren atención</div></div></div></section>
        <ProjectOverviewPreview project={project}/>
      </>}
      {tab==='chat'&&<section className='panel chatPanel'><div className='panelTitle'>CHAT EXCLUSIVO · {project.name.toUpperCase()}</div><div className='chatWindow projectChatWindow'>{messages.length?messages.map(m=><div key={m.id} className={'bubble '+m.role}><div className='markdownBody'>{renderProjectMarkdown(m.text)}</div>{m.role==='aria'&&m.processingMs!=null&&<small className='messageMeta'>Procesado en {formatProcessingTime(m.processingMs)}</small>}</div>):<div className='emptyState'>Contexto activo: {project.name}. ARIA debe distinguir este proyecto de los demás y usar solo memoria autorizada.</div>}</div>{sending&&<div className='chatThinking' role='status' aria-live='polite'><span className='thinkingOrb' aria-hidden='true'>🧠</span><div className='thinkingCopy'><strong>{processingLabel(processingElapsedMs)}</strong><small>Procesamiento en curso · {formatProcessingTime(processingElapsedMs)}</small></div><span className='thinkingDots' aria-hidden='true'>•••</span></div>}<div className='composer'><textarea ref={projectChatRef} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={'Habla con ARIA sobre '+project.name+'…'}/><button className='send' aria-label={sending?'Procesando mensaje':'Enviar mensaje'} disabled={sending||!text.trim()||!projectChatReady} onClick={()=>void send()}>{sending?'…':'↑'}</button><div className='composerStatus' aria-live='polite'>{sending?('Procesando… '+formatProcessingTime(processingElapsedMs)):error?'Error · revisa el mensaje':!projectChatReady?'Cargando conversación…':lastProcessingMs!=null?('Último procesamiento · '+formatProcessingTime(lastProcessingMs)):'Listo para enviar'}</div></div></section>}
      {tab==='missions'&&<section className='panel'><div className='panelHeading'><div><div className='panelTitle'>MISIONES · {project.name.toUpperCase()}</div><h2>Cola y evidencia</h2></div><button className='ghost' onClick={()=>void loadMissions()}>Actualizar</button></div><div className='missionCreateRow'><textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder={'Describe la misión que ARIA debe realizar en '+project.name+'…'}/><button className='primary' disabled={sending||!goal.trim()} onClick={()=>void createMission()}>{sending?'…':'Crear misión'}</button></div><div className='catalogList'>{missions.map((m,index)=><button key={m.mission_id} className={'projectMissionRow '+statusClass(String(m.status))} onClick={()=>void openMission(m.mission_id)}><div className='projectMissionMain'><div className='projectMissionHeader'><strong>{missionListLabel({...m,project_id:project.id},index)}</strong><span className={'pill '+statusClass(String(m.status))}>{statusLabel(String(m.status))}</span></div><small className='projectMissionTitle'>{missionHumanTitle({...m,project_id:project.id})}</small><small>{statusLabel(String(m.status))} · {m.completed_steps??0}/{m.total_steps??m.steps?.length??0} pasos · {m.updated_at?new Date(m.updated_at).toLocaleTimeString('es'):''}</small><small>{missionGoalPreview(m,90)}</small><span className='projectMissionProgress' aria-hidden='true'><i style={{width:(Math.max(0,Math.min(100,Number(m.completed_steps??0)/Math.max(1,Number(m.total_steps??m.steps?.length??1))*100))+'%')}} /></span></div></button>)}{!missions.length&&<div className='emptyState'>Todavía no hay misiones para este proyecto.</div>}</div></section>}
      {tab==='visual'&&<VisualBoard session={session} project={project} conversationId={conversationId} onChat={(m,cid)=>{if(cid)setConversationId(cid);setMessages(x=>[...x,{id:crypto.randomUUID(),role:'aria',text:m}]);selectTab('chat')}} onMission={createMission}/>}
    </div>
    {selectedMission&&<div className='modalBackdrop' onClick={()=>setSelectedMission(null)}><section className='detailModal' onClick={e=>e.stopPropagation()}><div className='detailTop'><div><div className='eyebrow'>MISIÓN · {project.name}</div><h2>{selectedMission.goal}</h2><span className={'pill '+statusClass(String(selectedMission.status))}>{statusLabel(String(selectedMission.status))}</span></div><button className='ghost' onClick={()=>setSelectedMission(null)}>Cerrar</button></div>{selectedMission.block_details&&['blocked','failed','waiting'].includes(String(selectedMission.status))&&<div className='detailResult'><div className='panelTitle'>{String(selectedMission.status)==='blocked'?'DIAGNÓSTICO DEL BLOQUEO':'RECUPERACIÓN / DIAGNÓSTICO'}</div><div className='humanSummaryGrid'><div><strong>Motivo</strong><p>{selectedMission.block_details.reason||'Sin motivo registrado.'}</p></div><div><strong>Qué está haciendo ARIA</strong><p>{selectedMission.block_details.next_action||selectedMission.next_action||'ARIA determinará la siguiente estrategia gobernada.'}</p></div><div><strong>Cómo solucionarlo</strong><p>{selectedMission.block_details.remediation||'Revisar la evidencia y definir una estrategia gobernada.'}</p></div><div><strong>¿Se puede recuperar?</strong><p>{selectedMission.block_details.recoverable?'Sí.':'No con la estrategia actual.'}</p></div></div>{selectedMission.block_details.evidence&&<div className='muted'>Evidencia: paso {String(selectedMission.block_details.evidence.step_id||'—')} · {String(selectedMission.block_details.evidence.verification_status||selectedMission.block_details.evidence.result_status||'estado registrado')}</div>}</div>}<div className='detailGrid'><div className='statCard'><div className='statValue'>{selectedMission.completed_steps??0}</div><div className='statLabel'>Pasos</div></div><div className='statCard'><div className='statValue'>{selectedMission.total_steps??selectedMission.steps?.length??0}</div><div className='statLabel'>Total</div></div><div className='statCard'><div className='statValue'>{selectedMission.finished_at?'Final':'En curso'}</div><div className='statLabel'>Estado</div></div></div><div className='detailResult'><div className='panelTitle'>RESULTADO</div><pre>{resultText(selectedMission)||'Aún no existe resultado textual final.'}</pre></div><div className='detailTimeline'><div className='panelTitle'>PASOS Y VERIFICACIÓN</div>{(selectedMission.steps||[]).map((s:any)=><div className='timelineRow' key={s.id}><span className='timelineDot'/><div><strong>Paso {s.index}: {s.title}</strong><small>{statusLabel(String(s.status))} · {s.executor_type||'ejecución'} · {s.operation||'operación'} · verificación: {s?.result?.__aria_verification_evidence?.verified===true||s?.result?.verification_status==='verified'||s?.result?.repair?.verification_status==='verified'?'PASS':'pendiente/no expuesta'}</small></div></div>)}</div></section></div>}
  </main>;
}
