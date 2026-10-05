#!/usr/bin/env node
'use strict';
const API_KEY=process.env.OMNIROUTE_API_KEY;
const ENDPOINT=process.env.OMNIROUTE_ENDPOINT||'http://127.0.0.1:20128/v1/chat/completions';
const MODEL=process.env.OMNIROUTE_MODEL||'auto';
const task=process.env.OMNIROUTE_E2E_TASK||'Return exactly the word OMNIROUTE_OK.';
if(!API_KEY){console.error('BLOCKED: OMNIROUTE_API_KEY is required at runtime and is never persisted.');process.exit(2);}
async function main(){
  const url=new URL(ENDPOINT);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','::1'].includes(url.hostname.replace(/^\[|\]$/g,''))||!url.pathname.endsWith('/chat/completions'))throw new Error('endpoint must be loopback HTTP chat/completions');
  const res=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:MODEL,messages:[{role:'user',content:task}],stream:false})});
  let json=null;try{json=await res.json();}catch{}
  const content=typeof json?.choices?.[0]?.message?.content==='string'?json.choices[0].message.content:'';
  const safe={status:res.ok?'PASS':'FAIL',http_status:res.status,model:json?.model||MODEL,content_present:Boolean(content.trim()),provider_response_id:typeof json?.id==='string'?json.id:null};
  console.log(JSON.stringify(safe));
  if(!res.ok||!content.trim())process.exit(1);
}
main().catch(error=>{console.error('LIVE_FAIL '+String(error.message||error));process.exit(1);});