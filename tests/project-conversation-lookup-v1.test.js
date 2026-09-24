const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-app-api-v3','index.ts'),'utf8');
assert(src.includes('aria_app_get_or_create_project_conversation'));
assert(src.includes('p_project_id:project.id'));
assert(src.includes('p_project_name:project.name'));
assert(!src.includes('.eq("metadata->>project_id",project.id)'));
console.log('PROJECT CONVERSATION LOOKUP: PASS — project chat uses the canonical owner-scoped RPC and no fragile PostgREST JSONB-path filter.');
