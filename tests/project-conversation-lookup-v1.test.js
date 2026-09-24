const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-app-api-v3','index.ts'),'utf8');
assert(src.includes('const {data:projectConversationRows,error}=await sb.schema("aria_app").from("conversations")'));
assert(src.includes('String(md?.project_id||"").toLowerCase()===project.id'));
assert(!src.includes('.eq("metadata->>project_id",project.id)'));
console.log('PROJECT CONVERSATION LOOKUP: PASS — owner-scoped rows are filtered in application code without PostgREST JSONB-path parsing.');
