import { useEffect, useMemo, useRef, useState } from 'react';

type Session = { accessToken: string; userId: string };
type Project = { id: string; name: string; description: string; icon: string; context: string };
type Tool = 'pen'|'marker'|'line'|'rect'|'circle'|'arrow'|'text'|'eraser';
type Point = { x:number; y:number };
type DrawAction = { tool:Tool; color:string; size:number; points:Point[]; text?:string };

const API = '/api';
const PROJECTS: Project[] = [
  { id:'battlecruiser', name:'BattleCruiser', description:'Sistema operativo privado para organizar el trabajo y la operación de La Cueva.', icon:'🏴‍☠️', context:'BattleCruiser es un proyecto operativo privado. Usa estado LIVE y ChatBending como contexto autorizado y no inventes estado técnico o de negocio.' },
  { id:'cuevacoin', name:'CuevaCoin', description:'Aplicación financiera/operativa vinculada al ecosistema de negocios.', icon:'🪙', context:'CuevaCoin es un proyecto financiero/operativo. Los cambios requieren verificación adicional antes de considerarse terminados.' },
  { id:'aria', name:'ARIA', description:'Núcleo cognitivo autónomo, gobernado y verificable.', icon:'🧠', context:'ARIA es el sistema cognitivo operativo. Usa el estado LIVE, main y evidencia persistida como fuentes prioritarias.' }
];

async function api(path:string, token:string, init:RequestInit={}) {
  const headers = new Headers(init.headers);
  headers.set('authorization','Bearer '+token);
  if (init.body) headers.set('content-type','application/json');
  const response = await fetch(API+path,{...init,headers,cache:'no-store'});
  const raw = await response.text();
  let data:any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) throw new Error(data?.error_description || data?.error || 'ARIA API error');
  return data;
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

function VisualBoard({session,project,conversationId,onChat,onMission}:{session:Session;project:Project;conversationId:string|null;onChat:(message:string,conversationId?:string)=>void;onMission:(payload:any)=>void}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool,setTool] = useState<Tool>('pen');
  const [color,setColor] = useState('#9f7cff');
  const [size,setSize] = useState(6);
  const [instruction,setInstruction] = useState('');
  const [actions,setActions] = useState<DrawAction[]>([]);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [backgroundDataUrl,setBackgroundDataUrl] = useState<string|null>(null);
  const backgroundImage = useRef<HTMLImageElement|null>(null);
  const drawing = useRef(false);
  const startPoint = useRef<Point|null>(null);

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
    ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,1100,650);ctx.fillStyle='#0e0b17';ctx.fillRect(0,0,1100,650);
    const paintForeground=()=>{ctx.globalAlpha=1;ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
      for(let x=0;x<=1100;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,650);ctx.stroke()}
      for(let y=0;y<=650;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1100,y);ctx.stroke()}
      actions.forEach(a=>drawOne(ctx,a));
    };
    if(backgroundImage.current?.complete&&backgroundImage.current.naturalWidth){const img=backgroundImage.current;const scale=Math.min(1100/img.naturalWidth,650/img.naturalHeight);const w=img.naturalWidth*scale,h=img.naturalHeight*scale;ctx.drawImage(img,(1100-w)/2,(650-h)/2,w,h);paintForeground();}else paintForeground();
  };
  const resize = () => { const c=canvasRef.current;if(!c)return;const d=window.devicePixelRatio||1;c.width=1100*d;c.height=650*d;redraw(); };
  useEffect(()=>{resize();const f=()=>resize();window.addEventListener('resize',f);return()=>window.removeEventListener('resize',f)},[]);
  useEffect(()=>redraw(),[actions,backgroundDataUrl]);
  function loadBackground(file:File){if(!file.type.startsWith('image/')){setNotice('La base visual debe ser una imagen.');return}const reader=new FileReader();reader.onload=()=>{const src=String(reader.result||'');const img=new Image();img.onload=()=>{backgroundImage.current=img;setBackgroundDataUrl(src);setNotice('Captura/base visual cargada. Ahora puedes dibujar encima.')};img.src=src};reader.readAsDataURL(file)}

  const pointFromEvent = (e:React.PointerEvent) => {
    const c=canvasRef.current;if(!c)return null;const r=c.getBoundingClientRect();
    return {x:(e.clientX-r.left)*1100/r.width,y:(e.clientY-r.top)*650/r.height};
  };
  const pointerDown = (e:React.PointerEvent) => {
    const p=pointFromEvent(e);if(!p)return;canvasRef.current?.setPointerCapture(e.pointerId);drawing.current=true;startPoint.current=p;
    if(tool==='text'){
      const text=instruction.trim();
      if(text) setActions(a=>[...a,{tool:'text',color,size,points:[p],text:text.slice(0,120)}]);
      else setNotice('Escribe primero el texto en el campo de instrucción.');
      drawing.current=false;
      return;
    }
    setActions(a=>[...a,{tool,color,size,points:[p]}]);
  };
  const pointerMove = (e:React.PointerEvent) => {
    if(!drawing.current)return;const p=pointFromEvent(e);if(!p)return;
    setActions(a=>{if(!a.length)return a;const next=[...a];const last={...next[next.length-1]};last.points=['pen','marker','eraser'].includes(tool)?[...last.points,p]:[startPoint.current||p,p];next[next.length-1]=last;return next;});
  };
  const pointerUp = () => { drawing.current=false;startPoint.current=null; };
  const annotationSummary = useMemo(()=>{
    return actions.map((a,i)=>{const p=a.points[0],q=a.points[a.points.length-1]||p;return '#'+(i+1)+' '+a.tool+' inicio=('+Math.round(p.x)+','+Math.round(p.y)+') fin=('+Math.round(q.x)+','+Math.round(q.y)+') color='+a.color+' tamaño='+a.size+(a.text?' texto="'+a.text+'"':'');}).join('; ') || 'ninguna';
  },[actions]);

  async function send(createMission:boolean) {
    if(busy)return;setBusy(true);setNotice('');
    try {
      const c=canvasRef.current;if(!c)throw new Error('Lienzo no disponible.');
      const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('No se pudo exportar el diseño.')),'image/png'));
      const up=await api('/media/upload-url',session.accessToken,{method:'POST',body:JSON.stringify({fileName:project.id+'-visual.png',contentType:'image/png'})});
      const signed=up.signedUrl??up.upload?.signed_url;const path=up.path??up.upload?.path;
      const put=await fetch(signed,{method:'PUT',headers:{'content-type':'image/png'},body:blob});
      if(!put.ok)throw new Error('No se pudo guardar el diseño.');
      const visualContext={instruction:instruction.trim(),annotation_summary:'Proyecto='+project.name+'. Lienzo 1100x650. Anotaciones: '+annotationSummary+'.',image_path:path,mime_type:'image/png'};
      const text='Analiza este diseño visual del proyecto '+project.name+'. '+(instruction.trim()||'Usa las anotaciones como instrucciones exactas.')+'\n\nVISUAL_CONTEXT:\n'+visualContext.annotation_summary;
      const activeConversationId=conversationId||crypto.randomUUID();
      if(createMission){onMission({goal:text,visual_context:visualContext});setNotice('Misión preparada con el diseño visual.');}
      else { const response=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts:[{type:'text',text},{type:'file',fileId:path,path,mimeType:'image/png',filename:project.id+'-visual.png'}],clientMessageId:crypto.randomUUID(),conversationId:activeConversationId,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:visualContext})});const reply=response.parts?.find((p:any)=>p.type==='text')?.text||'Diseño visual enviado a ARIA.';onChat(reply, activeConversationId);setNotice(response.cognitive?.fallback_count?'Enviado; ARIA usó fallback gobernado.':'Enviado a ARIA.');}
    } catch (e) { setNotice(e instanceof Error?e.message:'No se pudo enviar el diseño.'); }
    finally { setBusy(false); }
  }

  return <section className='panel visualBoardPanel'>
    <div className='panelHeading'><div><div className='panelTitle'>ARTIA · VISUAL WORKSPACE</div><h2>Dibuja sobre {project.name}</h2><div className='muted'>Pinta, encierra, señala y escribe. ARIA recibe la imagen y el mapa estructurado de las anotaciones.</div></div><span className='pill live'>1100×650</span></div>
    <div className='drawToolbar'>
      <label className='fileButton'>📷 Cargar imagen <input type='file' accept='image/*' hidden onChange={e=>{const f=e.target.files?.[0];if(f)loadBackground(f);e.currentTarget.value=''}}/></label>
      {(['pen','marker','line','rect','circle','arrow','text','eraser'] as Tool[]).map(x=>
        <button
          type='button'
          key={x}
          className={'toolButton '+(tool===x?'selected':'')}
          onClick={()=>setTool(x)}
          aria-label={x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}
        >
          {x==='pen'?'✎':x==='marker'?'🖍':x==='line'?'╱':x==='rect'?'▭':x==='circle'?'◯':x==='arrow'?'➜':x==='text'?'T':'⌫'}
          <span>{x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}</span>
        </button>
      )}
      <label>Color <input aria-label='Color del dibujo' type='color' value={color} onChange={e=>setColor(e.target.value)}/></label>
      <label>Grosor <input aria-label='Grosor del trazo' type='range' min='2' max='28' value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <button type='button' className='ghost' onClick={()=>setActions(a=>a.slice(0,-1))}>Deshacer</button>
      <button type='button' className='ghost' onClick={()=>setActions([])}>Limpiar</button>
    </div>
    <div className='canvasWrap'><canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}/></div>
    <textarea className='visualInstruction' value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder='Ejemplo: Donde marqué el círculo quiero el botón X. La flecha indica que debe ir debajo de Y.'/><div className='muted visualHint'>Trazos registrados: {actions.length} · El mapa estructurado permite a ARIA razonar sobre la posición aunque el modelo visual no esté disponible.</div>
    {notice&&<div className='notice'>{notice}</div>}
    <div className='modalActions'><button className='ghost' disabled={busy} onClick={()=>void send(false)}>Enviar a chat</button><button className='primary' disabled={busy} onClick={()=>void send(true)}>Crear misión con este diseño</button></div>
  </section>;
}

export function ProjectWorkspace({session,onBack}:{session:Session;onBack:()=>void}) {
  const [project,setProject]=useState<Project>(PROJECTS[0]);
  const [tab,setTab]=useState<'overview'|'chat'|'missions'|'visual'>('overview');
  const [messages,setMessages]=useState<{id:string;role:'user'|'aria';text:string}[]>([]);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [text,setText]=useState('');const [goal,setGoal]=useState('');const [sending,setSending]=useState(false);const [error,setError]=useState('');
  const [missions,setMissions]=useState<any[]>([]);const [selectedMission,setSelectedMission]=useState<any|null>(null);
  async function loadMissions(){try{const d=await api('/projects/'+encodeURIComponent(project.id)+'/missions?limit=100',session.accessToken);setMissions(d.missions||[])}catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar las misiones.')}}
  async function loadProjectChat(){try{const d=await api('/projects/'+encodeURIComponent(project.id)+'/conversation',session.accessToken);setConversationId(d.conversation_id||null);const rows=Array.isArray(d.conversation?.messages)?d.conversation.messages:[];setMessages(rows.map((m:any)=>({id:String(m.message_id),role:m.role==='assistant'?'aria':'user',text:String(m.content||'')})).filter((m:any)=>m.text));}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el chat del proyecto.')}}
  useEffect(()=>{void loadMissions();void loadProjectChat()},[project.id]);

  async function send() {
    const clean=text.trim();if(!clean||sending)return;setSending(true);setError('');setMessages(m=>[...m,{id:crypto.randomUUID(),role:'user',text:clean}]);setText('');
    try { const id=conversationId||crypto.randomUUID();setConversationId(id);const d=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts:[{type:'text',text:clean}],clientMessageId:crypto.randomUUID(),conversationId:id,project_id:project.id,project:{id:project.id,name:project.name,context:project.context}})});const p=d.parts?.find((x:any)=>x.type==='text');if(p?.text)setMessages(m=>[...m,{id:crypto.randomUUID(),role:'aria',text:p.text}]);if(d.mission?.mission_id)await loadMissions();}catch(e){setError(e instanceof Error?e.message:'No se pudo hablar con ARIA.')}finally{setSending(false)}
  }
  async function createMission(payload:any={}) {
    const clean=String(payload.goal??goal).trim();if(!clean||sending)return;setSending(true);setError('');
    try { await api('/missions',session.accessToken,{method:'POST',body:JSON.stringify({goal:clean,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:payload.visual_context||null})});setGoal('');setTab('missions');await loadMissions(); } catch(e){setError(e instanceof Error?e.message:'No se pudo crear la misión.')} finally{setSending(false)}
  }

  return <main className='appShell projectShell'>
    <header className='topBar'><div><div className='eyebrow'>ARIA / PROYECTOS</div><h1>Proyectos</h1><div className='sub'>Chats aislados por proyecto · misiones en la misma cola canónica · espacio visual ARTIA.</div></div><div className='topActions'><button className='ghost' onClick={onBack}>← Centro</button></div></header>
    <section className='projectGrid' aria-label='Seleccionar proyecto'>{PROJECTS.map(p=><button type='button' key={p.id} className={'projectCard '+(p.id===project.id?'selected':'')} onClick={()=>{setProject(p);setTab('overview')}}><span className='projectIcon'>{p.icon}</span><div><strong>{p.name}</strong><small>{p.id==='battlecruiser'?'Operación':p.id==='cuevacoin'?'Finanzas':'Cerebro'}</small></div></button>)}</section>
    <section className='panel projectHero'><div><div className='eyebrow'>PROYECTO ACTUAL</div><h2>{project.icon} {project.name}</h2><p className='muted'>{project.context}</p></div></section>
    <div className='capTabs projectTabs'>{(['overview','chat','missions','visual'] as const).map(t=><button type='button' key={t} className={'tabButton '+(tab===t?'selected':'')} onClick={()=>setTab(t)}>{t==='overview'?'Resumen':t==='chat'?'Chat':t==='missions'?'Misiones':'ARTIA'}</button>)}</div>
    <div className='projectBodyViewport'>
    {error&&<div className='errorBox'>{error}</div>}
    {tab==='overview'&&<section className='panel'><div className='panelTitle'>COLA COMPARTIDA</div><h2>Una sola cola, tres espacios de trabajo</h2><p className='muted'>Todo entra en el mismo planner, executor, verification y evidence fabric de ARIA. El proyecto añade contexto y filtrado, no un runtime paralelo.</p><div className='statsGrid'><div className='statCard'><div className='statValue violet'>{missions.length}</div><div className='statLabel'>Misiones</div></div><div className='statCard'><div className='statValue cyan'>{missions.filter(m=>['running','queued','planning','waiting','paused'].includes(String(m.status))).length}</div><div className='statLabel'>Activas / en cola</div></div><div className='statCard'><div className='statValue green'>{missions.filter(m=>String(m.status)==='succeeded').length}</div><div className='statLabel'>Completadas verificadas</div></div><div className='statCard'><div className='statValue gold'>{missions.filter(m=>['blocked','failed'].includes(String(m.status))).length}</div><div className='statLabel'>Requieren atención</div></div></div></section>}
    {tab==='chat'&&<section className='panel chatPanel'><div className='panelTitle'>CHAT EXCLUSIVO · {project.name.toUpperCase()}</div><div className='chatWindow projectChatWindow'>{messages.length?messages.map(m=><div key={m.id} className={'bubble '+m.role}><pre className='projectBubbleText'>{m.text}</div></div>):<div className='emptyState'>Contexto activo: {project.name}. ARIA debe distinguir este proyecto de los demás y usar solo memoria autorizada.</div>}</div><div className='composer'><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={'Habla con ARIA sobre '+project.name+'…'}/><button className='send' disabled={sending||!text.trim()} onClick={()=>void send()}>{sending?'…':'↑'}</button></div></section>}
    {tab==='missions'&&<section className='panel'><div className='panelHeading'><div><div className='panelTitle'>MISIONES · {project.name.toUpperCase()}</div><h2>Cola y evidencia</h2></div></div><div className='missionCreateRow'><textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder={'Describe la misión que ARIA debe realizar en '+project.name+'…'}/><button className='primary' disabled={sending||!goal.trim()} onClick={()=>void createMission()}>{sending?'…':'Crear misión'}</button></div><div className='catalogList'>{missions.map(m=><button key={m.mission_id} className='projectMissionRow' onClick={()=>setSelectedMission(m)}><div><strong>{m.goal}</strong><small>{statusLabel(String(m.status))} · {m.completed_steps??0}/{m.total_steps??m.steps?.length??0} pasos</small></div><span className={'pill '+statusClass(String(m.status))}>{statusLabel(String(m.status))}</span></button>)}{!missions.length&&<div className='emptyState'>Todavía no hay misiones para este proyecto.</div>}</div></section>}
    {tab==='visual'&&<VisualBoard session={session} project={project} conversationId={conversationId} onChat={(m,cid)=>{if(cid)setConversationId(cid);setMessages(x=>[...x,{id:crypto.randomUUID(),role:'aria',text:m}]);setTab('chat')}} onMission={createMission}/>}
    </div>
    {selectedMission&&<div className='modalBackdrop' onClick={()=>setSelectedMission(null)}><section className='detailModal' onClick={e=>e.stopPropagation()}><div className='detailTop'><div><div className='eyebrow'>MISIÓN · {project.name}</div><h2>{selectedMission.goal}</h2><span className={'pill '+statusClass(String(selectedMission.status))}>{statusLabel(String(selectedMission.status))}</span></div><button className='ghost' onClick={()=>setSelectedMission(null)}>Cerrar</button></div><div className='detailGrid'><div className='statCard'><div className='statValue'>{selectedMission.completed_steps??0}</div><div className='statLabel'>Pasos</div></div><div className='statCard'><div className='statValue'>{selectedMission.total_steps??selectedMission.steps?.length??0}</div><div className='statLabel'>Total</div></div><div className='statCard'><div className='statValue'>{selectedMission.finished_at?'Final':'En curso'}</div><div className='statLabel'>Estado</div></div></div><div className='detailResult'><div className='panelTitle'>RESULTADO</div><pre>{resultText(selectedMission)||'Aún no existe resultado textual final.'}</pre></div><div className='detailTimeline'><div className='panelTitle'>PASOS Y VERIFICACIÓN</div>{(selectedMission.steps||[]).map((s:any)=><div className='timelineRow' key={s.id}><span className='timelineDot'/><div><strong>Paso {s.index}: {s.title}</strong><small>{statusLabel(String(s.status))} · {s.executor_type||'ejecución'} · {s.operation||'operación'} · verificación: {s?.result?.__aria_verification_evidence?.verified===true||s?.result?.verification_status==='verified'||s?.result?.repair?.verification_status==='verified'?'PASS':'pendiente/no expuesta'}</small></div></div>)}</div></section></div>}
  </main>;
}