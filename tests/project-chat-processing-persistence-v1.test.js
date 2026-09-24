const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const api=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-app-api-v3','index.ts'),'utf8');
const project=fs.readFileSync(path.join(__dirname,'..','pwa','src','ProjectWorkspace.tsx'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','pwa','src','App.tsx'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20260924023000_aria_app_persist_project_conversation_reuse.sql'),'utf8');

assert(api.includes('aria_app_persist_message'));
assert(api.includes('processing_ms: Date.now() - requestStartedAt'));
assert(api.includes('input_persistence_ms: initialPersistenceMs'));
assert(api.includes('assistant_persistence_ms: assistantPersistenceMs'));
assert(api.includes('persistenceWarning'));
assert(api.includes('if (persistedUserMessage?.conversation_id) conversationId = String(persistedUserMessage.conversation_id)'));
assert(project.includes('chatThinking'));
assert(project.includes('Procesamiento en curso'));
assert(project.includes('Procesado en {formatProcessingTime(m.processingMs)}'));
assert(app.includes('chatThinking'));
assert(app.includes('Procesamiento en curso'));
assert(app.includes('Procesado en {formatProcessingTime(m.processingMs)}'));
assert(migration.includes('project_existing_id'));
assert(migration.includes('target_conversation_id := project_existing_id'));
console.log('PROJECT CHAT PROCESSING + PERSISTENCE: PASS — atomic project persistence reuse, live processing indicator, and server timing telemetry contracts are present.');
