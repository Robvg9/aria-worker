'use strict';
const assert=require('assert');
const {classifyConversation}=require('../intelligence/fast-lane');

assert.equal(classifyConversation('hola').lane,'fast');
assert.equal(classifyConversation('Gracias').lane,'fast');
assert.equal(classifyConversation('¿Recuerdas lo que hicimos ayer?').lane,'deep');
assert.equal(classifyConversation('corrige el bug del router').lane,'deep');
assert.equal(classifyConversation('explica en una frase qué es ARIA').lane,'fast');
assert.equal(classifyConversation('').lane,'deep');
console.log('fast-lane contract: PASS');
