import { useEffect, useMemo, useRef, useState } from 'react';

type Session = { accessToken: string; userId: string };
type ChatMessage = { id:string; role:'user'|'aria'; text:string; processingMs?:number };
type Project = { id: string; name: string; description: string; icon: string; context: string; previewUrl?: string };
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
  { id:'battlecruiser', name:'BattleCruiser', description:'Sistema operativo privado para organizar el trabajo y la operación de La Cueva.', icon:'🏴‍☠️', context:'BattleCruiser es un proyecto operativo privado. Usa estado LIVE y ChatBending como contexto autorizado y no inventes estado técnico o de negocio.', previewUrl:'https://battlecruiser.robvg9.workers.dev/' },
  { id:'cuevacoin', name:'CuevaCoin', description:'Aplicación financiera/operativa vinculada al ecosistema de negocios.', icon:'🪙', context:'CuevaCoin es un proyecto financiero/operativo. Los cambios requieren verificación adicional antes de considerarse terminados.' },
  { id:'aria', name:'ARIA', description:'Núcleo cognitivo autónomo, gobernado y verificable.', icon:'🧠', context:'ARIA es el sistema cognitivo operativo. Usa el estado LIVE, main y evidencia persistida como fuentes prioritarias.' }
];

async function api(path:string, token:string, init:RequestInit={}) {
  const headers = new Headers(init.headers);
  headers.set('authorization','Bearer '+token);
  if (init.body) headers.set('content-type','application/json');
  const method=String(init.method||'GET').toUpperCase();
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),method==='GET'?12000:60000);
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
  ctx.fillText('Vista previa del proyecto · referencia visual para hablar con ARIA',48,87);
  const pulse=(frame%4)/3;
  ctx.fillStyle='rgba(159,124,255,'+(0.12+0.12*pulse)+')';
  ctx.beginPath(); ctx.arc(1000,63,10+4*pulse,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#d7cfff';
  ctx.font='700 13px Inter, sans-serif';
  ctx.fillText('LIVE PREVIEW',932,92);

  const cards=[{label:'Estado',value:'Activo'},{label:'Contexto',value:project.id==='aria'?'Cerebro':'Operación'},{label:'Misiones',value:'—'},{label:'Conversación',value:'Disponible'}];
  cards.forEach((card,i)=>{
    const x=24+i*264;
    ctx.fillStyle='#151020'; ctx.fillRect(x,142,246,88);
    ctx.strokeStyle='#2d2540'; ctx.strokeRect(x,142,246,88);
    ctx.font='600 12px Inter, sans-serif'; ctx.fillStyle='#8d839f'; ctx.fillText(card.label,x+16,167);
    ctx.font='800 22px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText(card.value,x+16,201);
  });

  ctx.fillStyle='#151020'; ctx.fillRect(24,248,1052,280);
  ctx.strokeStyle='#2d2540'; ctx.strokeRect(24,248,1052,280);
  ctx.font='700 14px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText('Área de trabajo del proyecto',48,278);
  ctx.font='500 13px Inter, sans-serif'; ctx.fillStyle='#9187a3';
  const lines=[project.context,'Usa círculos, flechas, texto y trazos para señalar exactamente qué debe cambiar.','Cuando termines, la anotación + instrucción pueden convertirse en una misión gobernada.'];
  lines.forEach((line,i)=>ctx.fillText(line.slice(0,115),48,309+i*26));
  const rows=[['Resumen','Estado y contexto principal'],['Chat','Conversación exclusiva del proyecto'],['Misiones','Trabajo, seguimiento y evidencia'],['ARTIA','Vista previa + anotación visual']];
  rows.forEach((row,i)=>{
    const y=390+i*31;
    ctx.fillStyle=i===3?'#30225c':'#1b152a'; ctx.fillRect(48,y,1004,23);
    ctx.fillStyle=i===3?'#e4dcff':'#b8aec8'; ctx.font='700 11px Inter, sans-serif'; ctx.fillText(row[0],62,y+16);
    ctx.font='500 11px Inter, sans-serif'; ctx.fillText(row[1],190,y+16);
  });
  ctx.fillStyle='#0f0b17'; ctx.fillRect(24,548,1052,62);
  ctx.fillStyle='#9f7cff'; ctx.fillRect(24,548,Math.max(120,240+frame*90),4);
  ctx.fillStyle='#7f7590'; ctx.font='500 12px Inter, sans-serif'; ctx.fillText('La vista previa se puede pausar para anotar encima.',48,585);
}

function VisualBoard({session,project,conversationId,onChat,onMission}:{session:Session;project:Project;conversationId:string|null;onChat:(message:string,conversationId?:string)=>void;onMission:(payload:any)=>Promise<any>}) {
  const livePreviewUrl = project.previewUrl || null;
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
    if(livePreviewUrl){
      ctx.clearRect(0,0,1100,650);
    } else if(backgroundImage.current?.complete&&backgroundImage.current.naturalWidth){
      const img=backgroundImage.current;const scale=Math.min(1100/img.naturalWidth,650/img.naturalHeight);const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
      ctx.fillStyle='#0e0b17';ctx.fillRect(0,0,1100,650);ctx.drawImage(img,(1100-w)/2,(650-h)/2,w,h);
    } else {
      drawProjectPreview(ctx,project,previewFrame);
    }
    if(previewPaused){
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
    const p=pointFromEvent(e);if(!p)return;canvasRef.current?.setPointerCapture(e.pointerId);drawing.current=true;startPoint.current=p;
    if(tool==='text'){const text=instruction.trim();if(text)setActions(a=>[...a,{tool:'text',color,size,points:[p],text:text.slice(0,120)}]);else setNotice('Escribe primero el texto que quieras colocar sobre la vista.');drawing.current=false;return;}
    setActions(a=>[...a,{tool,color,size,points:[p]}]);
  };
  const pointerMove=(e:React.PointerEvent)=>{if(!drawing.current||!previewPaused)return;const p=pointFromEvent(e);if(!p)return;setActions(a=>{if(!a.length)return a;const next=[...a];const last={...next[next.length-1]};last.points=['pen','marker','eraser'].includes(tool)?[...last.points,p]:[startPoint.current||p,p];next[next.length-1]=last;return next})};
  const pointerUp=()=>{drawing.current=false;startPoint.current=null};
  const annotationSummary=useMemo(()=>actions.map((a,i)=>{const p=a.points[0],q=a.points[a.points.length-1]||p;return '#'+(i+1)+' '+a.tool+' inicio=('+Math.round(p.x)+','+Math.round(p.y)+') fin=('+Math.round(q.x)+','+Math.round(q.y)+') color='+a.color+' tamaño='+a.size+(a.text?' texto="'+a.text+'"':'')}).join('; ')||'ninguna',[actions]);

  async function send(createMission:boolean){
    if(busy)return;
    if(!previewPaused){setNotice('Pausa la vista previa antes de enviar una anotación a ARIA.');return;}
    setBusy(true);setNotice('');
    try{
      const c=canvasRef.current;if(!c)throw new Error('Lienzo no disponible.');
      const blob=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('No se pudo exportar el diseño.')),'image/png'));
      const up=livePreviewUrl?null:await api('/media/upload-url',session.accessToken,{method:'POST',body:JSON.stringify({fileName:project.id+'-visual.png',contentType:'image/png'})});
      const signed=up?.signedUrl??up?.upload?.signed_url;const path=up?.path??up?.upload?.path; if(!livePreviewUrl){ const put=await fetch(signed,{method:'PUT',headers:{'content-type':'image/png'},body:blob});if(!put.ok)throw new Error('No se pudo guardar el diseño.'); }
      const visualContext={project_preview:true,preview_paused:true,preview_url:livePreviewUrl,instruction:instruction.trim(),annotation_summary:'Proyecto='+project.name+'. Vista previa LIVE pausada. Lienzo 1100x650. Anotaciones: '+annotationSummary+'.',image_path:livePreviewUrl?null:path,mime_type:livePreviewUrl?null:'image/png'};
      const text='TRABAJO VISUAL DE PROYECTO. Proyecto: '+project.name+'. PWA LIVE: '+(livePreviewUrl||'no configurada')+'. El usuario pausó la vista previa real y realizó estas anotaciones: '+annotationSummary+'. INSTRUCCIÓN DEL USUARIO: '+(instruction.trim()||'Interpreta las anotaciones como instrucciones exactas y pregunta solo si algo es realmente ambiguo.')+'\\n\\nVISUAL_CONTEXT:\\n'+visualContext.annotation_summary;
      const activeConversationId=conversationId||crypto.randomUUID();
      if(createMission){await onMission({goal:text,visual_context:visualContext});setNotice('Misión confirmada por ARIA con el diseño y las anotaciones.')}
      else{const parts:any[]=[{type:'text',text}]; if(!livePreviewUrl) parts.push({type:'file',fileId:path,path,mimeType:'image/png',filename:project.id+'-visual.png'}); const response=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts,clientMessageId:crypto.randomUUID(),conversationId:activeConversationId,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:visualContext})});const reply=response.parts?.find((p:any)=>p.type==='text')?.text||'Diseño visual enviado a ARIA.';onChat(reply,activeConversationId);setNotice('Diseño enviado a ARIA en el chat exclusivo del proyecto.')}
    }catch(e){setNotice(e instanceof Error?e.message:'No se pudo enviar el diseño.')}finally{setBusy(false)}
  }

  return <section className='panel visualBoardPanel'>
    <div className='panelHeading'><div><div className='panelTitle'>ARTIA · PROJECT PREVIEW</div><h2>Vista previa de {project.name}</h2><div className='muted'>Mira el proyecto, pausa la vista cuando quieras modificar algo y pinta directamente sobre esa referencia.</div></div><span className={'pill '+(previewPaused?'good':'live')}>{previewPaused?'Pausada · lista para pintar':'Reproduciendo'}</span></div>
    <div className='visualPreviewControls'><div className='visualPreviewControlGroup'><button type='button' className='ghost' onClick={()=>{setPreviewPaused(v=>!v);if(!previewPaused)setNotice('Vista previa pausada. Ya puedes pintar.');else setNotice('Vista previa reanudada. Las nuevas anotaciones se conservan.')}}>{previewPaused?'▶ Reproducir vista':'⏸ Pausar para pintar'}</button><button type='button' className='ghost' onClick={()=>void togglePreviewFullscreen()} aria-label={previewFullscreen?'Salir de pantalla completa':'Abrir vista previa en pantalla completa'}>{previewFullscreen?'↙ Salir':'⛶ Pantalla completa'}</button></div><span className='muted'>{backgroundDataUrl?'Referencia cargada':'Referencia nativa del proyecto'}</span></div>
    <div className='drawToolbar'>
      <label className='fileButton'>📷 Cargar captura de referencia <input type='file' accept='image/*' hidden onChange={e=>{const f=e.target.files?.[0];if(f)loadBackground(f);e.currentTarget.value=''}}/></label>
      {(['pen','marker','line','rect','circle','arrow','text','eraser'] as Tool[]).map(x=><button type='button' key={x} className={'toolButton '+(tool===x?'selected':'')} onClick={()=>setTool(x)} aria-label={x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}>{x==='pen'?'✎':x==='marker'?'🖍':x==='line'?'╱':x==='rect'?'▭':x==='circle'?'◯':x==='arrow'?'➜':x==='text'?'T':'⌫'}<span>{x==='pen'?'Lápiz':x==='marker'?'Marcador':x==='line'?'Línea':x==='rect'?'Rectángulo':x==='circle'?'Círculo':x==='arrow'?'Flecha':x==='text'?'Texto':'Borrador'}</span></button>)}
      <label>Color <input aria-label='Color del dibujo' type='color' value={color} onChange={e=>setColor(e.target.value)}/></label>
      <label>Grosor <input aria-label='Grosor del trazo' type='range' min='2' max='28' value={size} onChange={e=>setSize(Number(e.target.value))}/></label>
      <button type='button' className='ghost' disabled={!previewPaused||!actions.length||busy} onClick={()=>setActions(a=>a.slice(0,-1))}>Deshacer</button>
      <button type='button' className='ghost' disabled={!previewPaused||!actions.length||busy} onClick={()=>setActions([])}>Limpiar</button>
    </div>
    <div ref={previewShellRef} className={'canvasWrap artiaPreviewShell '+(previewFullscreen?'isFullscreen':'')} style={{position:'relative',width:'100%',aspectRatio:'1100 / 650',overflow:'hidden'}}>
      {livePreviewUrl ? <iframe title={'PWA LIVE de '+project.name} src={livePreviewUrl} allow='fullscreen' style={{position:'absolute',inset:0,width:'100%',height:'100%',border:0,background:'#0e0b17',pointerEvents:previewPaused?'none':'auto'}} /> : null}
      <canvas ref={canvasRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:previewPaused?'auto':'none'}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label={'Capa de anotaciones visuales de '+project.name}/>
      {!livePreviewUrl && <div className='muted' style={{position:'absolute',inset:0,display:'grid',placeItems:'center',padding:24,textAlign:'center'}}>No hay una PWA LIVE configurada para este proyecto. La capa visual de referencia no sustituye una previsualización real.</div>}
      {previewFullscreen && <button type='button' className='artiaFullscreenExit' onClick={()=>void togglePreviewFullscreen()} aria-label='Salir de pantalla completa'>↙ Salir</button>}
    </div>
    <textarea className='visualInstruction' value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder='Describe qué debe cambiar. Lo escrito + lo pintado se convierten en contexto de ARIA y pueden saltar directamente como misión.'/><div className='muted visualHint'>Anotaciones: {actions.length} · {previewPaused?'La vista está pausada; las anotaciones quedan sobre la referencia.':'Pausa la vista para habilitar el lienzo.'}</div>
    {notice&&<div className='notice'>{notice}</div>}
    <div className='modalActions'><button className='ghost' disabled={busy||!previewPaused} onClick={()=>void send(false)}>Enviar a chat</button><button className='primary' disabled={busy||!previewPaused||(!instruction.trim()&&!actions.length)} onClick={()=>void send(true)}>Crear misión con este diseño</button></div>
  </section>;
}

export function ProjectWorkspace({session,onBack}:{session:Session;onBack:()=>void}) {
  const PROJECT_KEY='aria_project_selection_v2:'+session.userId;
  const TAB_KEY=(projectId:string)=>'aria_project_tab_v2:'+session.userId+':'+projectId;
  const [project,setProject]=useState<Project>(()=>{try{const id=localStorage.getItem(PROJECT_KEY);return PROJECTS.find(p=>p.id===id)||PROJECTS[0]}catch{return PROJECTS[0]}});
  const [tab,setTab]=useState<'overview'|'chat'|'missions'|'visual'>(()=>{try{const saved=localStorage.getItem(TAB_KEY(PROJECTS[0].id));return (saved as any)||'overview'}catch{return 'overview'}});
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const processingStartedAtRef=useRef<number|null>(null);
  const [processingElapsedMs,setProcessingElapsedMs]=useState(0);
  const [lastProcessingMs,setLastProcessingMs]=useState<number|null>(null);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [text,setText]=useState('');
  const [goal,setGoal]=useState('');
  const [sending,setSending]=useState(false);
  const [error,setError]=useState('');
  const [missions,setMissions]=useState<any[]>([]);
  const [selectedMission,setSelectedMission]=useState<any|null>(null);
  const projectChatRef=useRef<HTMLTextAreaElement|null>(null);

  useEffect(()=>{try{localStorage.setItem(PROJECT_KEY,project.id);localStorage.setItem(TAB_KEY(project.id),tab)}catch{}},[project.id,tab,session.userId]);

  async function loadMissions(){try{const d=await api('/projects/'+encodeURIComponent(project.id)+'/missions?limit=100',session.accessToken);setMissions(d.missions||[])}catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar las misiones.')}}

  async function loadProjectChat(){try{const d=await api('/projects/'+encodeURIComponent(project.id)+'/conversation',session.accessToken);setConversationId(d.conversation_id||null);const rows=Array.isArray(d.conversation?.messages)?d.conversation.messages:[];setMessages(rows.map((m:any)=>({id:String(m.message_id),role:m.role==='assistant'?'aria':'user',text:String(m.content||'')})).filter((m:any)=>m.text.trim()))}catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el chat del proyecto.')}}

  useEffect(()=>{
    if(!sending){setProcessingElapsedMs(0);return;}
    const startedAt=processingStartedAtRef.current??Date.now();
    processingStartedAtRef.current=startedAt;
    const tick=()=>setProcessingElapsedMs(Date.now()-startedAt);
    tick();
    const timer=window.setInterval(tick,200);
    return()=>window.clearInterval(timer);
  },[sending]);

  useEffect(()=>{setSelectedMission(null);setError('');try{const saved=localStorage.getItem(TAB_KEY(project.id));if(saved)setTab(saved as any)}catch{}void loadMissions();void loadProjectChat()},[project.id]);

  useEffect(()=>{const refresh=()=>{if(tab==='missions'||tab==='overview')void loadMissions()};void refresh();const timer=window.setInterval(refresh,5000);return()=>window.clearInterval(timer)},[project.id,tab,session.accessToken]);

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
    const clean=text.trim();if(!clean||sending)return;
    setSending(true);setError('');processingStartedAtRef.current=Date.now();setProcessingElapsedMs(0);setLastProcessingMs(null);
    setMessages(m=>[...m,{id:crypto.randomUUID(),role:'user',text:clean}]);setText('');
    try{
      const id=conversationId||crypto.randomUUID();setConversationId(id);
      const d=await api('/conversation',session.accessToken,{method:'POST',body:JSON.stringify({parts:[{type:'text',text:clean}],clientMessageId:crypto.randomUUID(),conversationId:id,project_id:project.id,project:{id:project.id,name:project.name,context:project.context}})});
      const p=d.parts?.find((x:any)=>x.type==='text');
      const serverProcessingMs=Number(d?.cognitive?.processing_ms);
      if(Number.isFinite(serverProcessingMs)&&serverProcessingMs>=0)setLastProcessingMs(serverProcessingMs);
      else if(processingStartedAtRef.current)setLastProcessingMs(Date.now()-processingStartedAtRef.current);
      if(p?.text)setMessages(m=>[...m,{id:crypto.randomUUID(),role:'aria',text:p.text,processingMs:Number.isFinite(serverProcessingMs)?serverProcessingMs:undefined}]);
      if(d.mission?.mission_id)await loadMissions();
      await loadProjectChat();
    }catch(e){await loadProjectChat().catch(()=>{});setError(e instanceof Error?e.message:'No se pudo hablar con ARIA.')}finally{setSending(false)}
  }

  async function createMission(payload:any={}){
    const clean=String(payload.goal??goal).trim();if(!clean||sending)return;
    setSending(true);setError('');
    try{
      const d=await api('/missions',session.accessToken,{method:'POST',body:JSON.stringify({goal:clean,project_id:project.id,project:{id:project.id,name:project.name,context:project.context},visual_context:payload.visual_context||null})});
      if(!d?.mission?.mission_id)throw new Error('ARIA no confirmó la creación de la misión.');
      setGoal('');selectTab('missions');await loadMissions();setTimeout(()=>void loadMissions(),1200);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo crear la misión.')}finally{setSending(false)}
  }

  return <main className='appShell projectShell'>
    <section className='projectGrid' aria-label='Seleccionar proyecto'>{PROJECTS.map(p=><button type='button' key={p.id} className={'projectCard '+(p.id===project.id?'selected':'')} onClick={()=>selectProject(p)}><span className='projectIcon'>{p.icon}</span><div><strong>{p.name}</strong><small>{p.id==='battlecruiser'?'Operación':p.id==='cuevacoin'?'Finanzas':'Cerebro'}</small></div></button>)}</section>
    {tab!=='chat' && <section className='panel projectHero'><div><div className='eyebrow'>PROYECTO ACTUAL</div><h2>{project.icon} {project.name}</h2><p className='muted'>{project.context}</p></div></section>}
    <div className='capTabs projectTabs' aria-label='Secciones del proyecto'>{(['overview','chat','missions','visual'] as const).map(t=><button type='button' key={t} className={'tabButton '+(tab===t?'selected':'')} onClick={()=>selectTab(t)}>{t==='overview'?'Resumen':t==='chat'?'Chat':t==='missions'?'Misiones':'ARTIA'}</button>)}</div>
    <div className='projectBodyViewport'>
      {error&&<div className='errorBox'>{error}</div>}
      {tab==='overview'&&<section className='panel'><div className='panelTitle'>COLA COMPARTIDA</div><h2>Una sola cola, tres espacios de trabajo</h2><p className='muted'>Todo entra en el mismo planner, executor, verification y evidence fabric de ARIA. El proyecto añade contexto y filtrado, no un runtime paralelo.</p><div className='statsGrid'><div className='statCard'><div className='statValue violet'>{missions.length}</div><div className='statLabel'>Misiones</div></div><div className='statCard'><div className='statValue cyan'>{missions.filter(m=>['running','queued','planning','waiting','paused'].includes(String(m.status))).length}</div><div className='statLabel'>Activas / en cola</div></div><div className='statCard'><div className='statValue green'>{missions.filter(m=>String(m.status)==='succeeded').length}</div><div className='statLabel'>Completadas verificadas</div></div><div className='statCard'><div className='statValue gold'>{missions.filter(m=>['blocked','failed'].includes(String(m.status))).length}</div><div className='statLabel'>Requieren atención</div></div></div></section>}
      {tab==='chat'&&<section className='panel chatPanel'><div className='panelTitle'>CHAT EXCLUSIVO · {project.name.toUpperCase()}</div><div className='chatWindow projectChatWindow'>{messages.length?messages.map(m=><div key={m.id} className={'bubble '+m.role}><div className='markdownBody'>{renderProjectMarkdown(m.text)}</div>{m.role==='aria'&&m.processingMs!=null&&<small className='messageMeta'>Procesado en {formatProcessingTime(m.processingMs)}</small>}</div>):<div className='emptyState'>Contexto activo: {project.name}. ARIA debe distinguir este proyecto de los demás y usar solo memoria autorizada.</div>}</div>{sending&&<div className='chatThinking' role='status' aria-live='polite'><span className='thinkingOrb' aria-hidden='true'>🧠</span><div className='thinkingCopy'><strong>{processingLabel(processingElapsedMs)}</strong><small>Procesamiento en curso · {formatProcessingTime(processingElapsedMs)}</small></div><span className='thinkingDots' aria-hidden='true'>•••</span></div>}<div className='composer'><textarea ref={projectChatRef} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send()}}} placeholder={'Habla con ARIA sobre '+project.name+'…'}/><button className='send' aria-label={sending?'Procesando mensaje':'Enviar mensaje'} disabled={sending||!text.trim()} onClick={()=>void send()}>{sending?'…':'↑'}</button><div className='composerStatus' aria-live='polite'>{sending?('Procesando… '+formatProcessingTime(processingElapsedMs)):error?'Error · revisa el mensaje':lastProcessingMs!=null?('Último procesamiento · '+formatProcessingTime(lastProcessingMs)):'Listo para enviar'}</div></div></section>}
      {tab==='missions'&&<section className='panel'><div className='panelHeading'><div><div className='panelTitle'>MISIONES · {project.name.toUpperCase()}</div><h2>Cola y evidencia</h2></div><button className='ghost' onClick={()=>void loadMissions()}>Actualizar</button></div><div className='missionCreateRow'><textarea value={goal} onChange={e=>setGoal(e.target.value)} placeholder={'Describe la misión que ARIA debe realizar en '+project.name+'…'}/><button className='primary' disabled={sending||!goal.trim()} onClick={()=>void createMission()}>{sending?'…':'Crear misión'}</button></div><div className='catalogList'>{missions.map(m=><button key={m.mission_id} className='projectMissionRow' onClick={()=>void openMission(m.mission_id)}><div><strong>{m.goal}</strong><small>{statusLabel(String(m.status))} · {m.completed_steps??0}/{m.total_steps??m.steps?.length??0} pasos · {m.updated_at?new Date(m.updated_at).toLocaleTimeString('es'):''}</small></div><span className={'pill '+statusClass(String(m.status))}>{statusLabel(String(m.status))}</span></button>)}{!missions.length&&<div className='emptyState'>Todavía no hay misiones para este proyecto.</div>}</div></section>}
      {tab==='visual'&&<VisualBoard session={session} project={project} conversationId={conversationId} onChat={(m,cid)=>{if(cid)setConversationId(cid);setMessages(x=>[...x,{id:crypto.randomUUID(),role:'aria',text:m}]);selectTab('chat')}} onMission={createMission}/>}
    </div>
    {selectedMission&&<div className='modalBackdrop' onClick={()=>setSelectedMission(null)}><section className='detailModal' onClick={e=>e.stopPropagation()}><div className='detailTop'><div><div className='eyebrow'>MISIÓN · {project.name}</div><h2>{selectedMission.goal}</h2><span className={'pill '+statusClass(String(selectedMission.status))}>{statusLabel(String(selectedMission.status))}</span></div><button className='ghost' onClick={()=>setSelectedMission(null)}>Cerrar</button></div>{selectedMission.block_details&&['blocked','failed','waiting'].includes(String(selectedMission.status))&&<div className='detailResult'><div className='panelTitle'>{String(selectedMission.status)==='blocked'?'DIAGNÓSTICO DEL BLOQUEO':'RECUPERACIÓN / DIAGNÓSTICO'}</div><div className='humanSummaryGrid'><div><strong>Motivo</strong><p>{selectedMission.block_details.reason||'Sin motivo registrado.'}</p></div><div><strong>Qué está haciendo ARIA</strong><p>{selectedMission.block_details.next_action||selectedMission.next_action||'ARIA determinará la siguiente estrategia gobernada.'}</p></div><div><strong>Cómo solucionarlo</strong><p>{selectedMission.block_details.remediation||'Revisar la evidencia y definir una estrategia gobernada.'}</p></div><div><strong>¿Se puede recuperar?</strong><p>{selectedMission.block_details.recoverable?'Sí.':'No con la estrategia actual.'}</p></div></div>{selectedMission.block_details.evidence&&<div className='muted'>Evidencia: paso {String(selectedMission.block_details.evidence.step_id||'—')} · {String(selectedMission.block_details.evidence.verification_status||selectedMission.block_details.evidence.result_status||'estado registrado')}</div>}</div>}<div className='detailGrid'><div className='statCard'><div className='statValue'>{selectedMission.completed_steps??0}</div><div className='statLabel'>Pasos</div></div><div className='statCard'><div className='statValue'>{selectedMission.total_steps??selectedMission.steps?.length??0}</div><div className='statLabel'>Total</div></div><div className='statCard'><div className='statValue'>{selectedMission.finished_at?'Final':'En curso'}</div><div className='statLabel'>Estado</div></div></div><div className='detailResult'><div className='panelTitle'>RESULTADO</div><pre>{resultText(selectedMission)||'Aún no existe resultado textual final.'}</pre></div><div className='detailTimeline'><div className='panelTitle'>PASOS Y VERIFICACIÓN</div>{(selectedMission.steps||[]).map((s:any)=><div className='timelineRow' key={s.id}><span className='timelineDot'/><div><strong>Paso {s.index}: {s.title}</strong><small>{statusLabel(String(s.status))} · {s.executor_type||'ejecución'} · {s.operation||'operación'} · verificación: {s?.result?.__aria_verification_evidence?.verified===true||s?.result?.verification_status==='verified'||s?.result?.repair?.verification_status==='verified'?'PASS':'pendiente/no expuesta'}</small></div></div>)}</div></section></div>}
  </main>;
}
