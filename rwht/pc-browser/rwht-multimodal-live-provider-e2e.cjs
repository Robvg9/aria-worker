'use strict';

const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const PWA_URL = process.env.RWHT_PWA_URL || 'https://aria.robvg9.workers.dev/pwa/';
const STORAGE_STATE = process.env.RWHT_STORAGE_STATE;
if (!STORAGE_STATE || !fs.existsSync(STORAGE_STATE)) throw new Error('storage_state_required');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng(width=128,height=128){
  const raw=Buffer.alloc((width*3+1)*height);
  const set=(x,y,r,g,b)=>{const i=y*(width*3+1)+1+x*3;raw[i]=r;raw[i+1]=g;raw[i+2]=b;};
  for(let y=0;y<height;y++){raw[y*(width*3+1)]=0;for(let x=0;x<width;x++)set(x,y,255,255,255);}
  for(let y=20;y<76;y++)for(let x=20;x<76;x++)set(x,y,230,30,30);
  const cx=96,cy=96,radius=24;
  for(let y=cy-radius;y<=cy+radius;y++)for(let x=cx-radius;x<=cx+radius;x++)if((x-cx)**2+(y-cy)**2<=radius**2)set(x,y,25,70,220);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',zlib.deflateSync(raw,{level:9})),pngChunk('IEND',Buffer.alloc(0))]);
}

(async()=>{
  const context=await chromium.launchPersistentContext('',{headless:true,storageState:STORAGE_STATE,viewport:{width:1366,height:768}});
  try{
    const page=await context.newPage();
    const base=PWA_URL.replace(/\/$/,'');
    const vr=await page.request.get(base+'/version.json?persist-recovery='+Date.now());
    const version=await vr.json().catch(()=>null);
    if(!vr.ok()||!version?.build)throw new Error('live_build_unavailable');
    if(version.build!=='af9c816a013d83e08675ba4486edab5b7b1f38b1')throw new Error('live_build_mismatch:'+version.build);
    await page.goto(PWA_URL,{waitUntil:'domcontentloaded',timeout:60000});

    const ur=await page.request.post(base+'/api/media/upload-url',{data:{fileName:'aria-phase7-live.png'},headers:{'content-type':'application/json','x-aria-pwa-build':String(version.build)}});
    const um=await ur.json().catch(()=>null);
    if(!ur.ok()||!um?.signedUrl||!um?.path)throw new Error('media_upload_url_failed:'+ur.status());

    const png=makePng();
    const put=await fetch(um.signedUrl,{method:'PUT',headers:{'content-type':'image/png','cache-control':'no-cache'},body:png});
    if(!put.ok)throw new Error('media_upload_failed:'+put.status);

    const marker='ARIA_MULTIMODAL_LIVE_OK: RED-SQUARE-BLUE-CIRCLE';
    const prompt='Inspect the attached image. Reply with the exact marker "'+marker+'" only if you can actually see one red square and one blue circle. Otherwise reply "ARIA_MULTIMODAL_LIVE_FAIL". Do not guess.';
    const conversationId=crypto.randomUUID();
    const cr=await page.request.post(base+'/api/conversation',{data:{conversationId,parts:[{type:'text',text:prompt}],visual_context:{instruction:'Inspect the attached image and verify the visible red square and blue circle.',image_path:um.path,mime_type:'image/png'}},headers:{'content-type':'application/json','x-aria-pwa-build':String(version.build)}});
    const body=await cr.json().catch(()=>null);
    const answer=String(body?.parts?.find?.(p=>p?.type==='text')?.text??'');
    const cognitive=body?.cognitive??{};
    if(!cr.ok())throw new Error('conversation_failed:'+cr.status()+':'+JSON.stringify(body));
    if(cognitive.provider_id!=='google')throw new Error('wrong_provider:'+cognitive.provider_id);
    if(!String(cognitive.model_id||'').startsWith('google/'))throw new Error('wrong_model:'+cognitive.model_id);
    if(!answer.includes(marker)||answer.includes('ARIA_MULTIMODAL_LIVE_FAIL'))throw new Error('provider_did_not_confirm_image:'+answer);
    console.log(JSON.stringify({status:'verified',marker,live_build:version.build,provider_id:cognitive.provider_id,model_id:cognitive.model_id,conversation_id:body.conversationId,media_bytes:png.length,response_text:answer,visual_context_sent:true,real_provider_request:true,real_model_request:true,processing_ms:cognitive.processing_ms??null,model_ms:cognitive.model_ms??null,input_persistence_ms:cognitive.input_persistence_ms??null,assistant_persistence_ms:cognitive.assistant_persistence_ms??null,persistence_warning:cognitive.persistence_warning??null},null,2));
  } finally { await context.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
