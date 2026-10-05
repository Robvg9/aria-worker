'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('pwa/src/App.tsx', 'utf8');
const sendStart = source.indexOf('async function send()');
const sendEnd = source.indexOf('\n  async function confirmPendingMission()', sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart, 'Chat.send function missing');

const send = source.slice(sendStart, sendEnd);
const persist = send.indexOf('writeChatHistory(');
const network = send.indexOf("api('/conversation'", persist);
const state = send.indexOf('setMessages(m => [...m, userMessage])', persist);

assert.ok(persist >= 0, 'send() must persist the user message');
assert.ok(network > persist, 'local persistence must occur before conversation POST');
assert.ok(state > persist, 'state update must remain after immediate persistence');
assert.match(send, /const activeConversationId = conversationId \?\? crypto\.randomUUID\(\);/);
assert.match(send, /text: clean \+ \(file \? '\\n\[' \+ file\.name \+ '\]' : ''\)/);

console.log('CHAT IMMEDIATE LOCAL PERSISTENCE CONTRACT: PASS');
