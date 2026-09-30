'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const appPath = path.join(__dirname, '..', 'pwa', 'src', 'App.tsx');
const app = fs.readFileSync(appPath, 'utf8');
assert.match(app, /loadMutationVersion !== chatMutationVersionRef\.current/, 'Late history responses must detect concurrent chat writes.');
assert.match(app, /setMessages\(current => mergeRestoredChatMessages\(restored, current\)\)/, 'Late history responses must merge with current messages.');
assert.match(app, /chatMutationVersionRef\.current \+= 1/g, 'Chat sends and mission confirmations must invalidate older history loads.');

(async () => {
  const { mergeRestoredChatMessages } = await import(pathToFileURL(path.join(__dirname, '..', 'pwa', 'src', 'chatHistory.js')).href);
  const restored = [
    { id: 'server-1', role: 'user', text: 'repeat' },
    { id: 'server-2', role: 'aria', text: 'older answer' }
  ];
  const current = [
    { id: 'cache-1', role: 'user', text: 'repeat' },
    { id: 'optimistic-1', role: 'user', text: 'repeat' },
    { id: 'optimistic-2', role: 'aria', text: 'new answer' }
  ];
  assert.deepStrictEqual(
    mergeRestoredChatMessages(restored, current),
    [...restored, current[1], current[2]],
    'Merge must keep in-flight messages, remove cached overlap, and retain repeated prompts.'
  );
  console.log('pwa-chat-history-race PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
