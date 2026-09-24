'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {classifyConversation}=require('../intelligence/fast-lane');

assert.equal(classifyConversation('hola').lane,'fast');
assert.equal(classifyConversation('Gracias').lane,'fast');
assert.equal(classifyConversation('¿Recuerdas lo que hicimos ayer?').lane,'deep');
assert.equal(classifyConversation('corrige el bug del router').lane,'deep');
assert.equal(classifyConversation('explica en una frase qué es ARIA').lane,'fast');
assert.equal(classifyConversation('¿Cuál es el estado actual de ARIA?').lane,'deep');
assert.equal(classifyConversation('').lane,'deep');

const api=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-app-api-v3','index.ts'),'utf8');
assert(api.includes('classifyConversation(text)'));
assert(api.includes('lane.lane === "deep" ? await recall'));
assert(api.includes('fast_lane: lane.lane'));
console.log('fast-lane contract: PASS');
