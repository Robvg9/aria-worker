'use strict';

const assert = require('node:assert/strict');
const { buildGeminiContents, normalizePart, fromPerceptionState } = require('../multimodal/gemini-content-v1');

assert.deepEqual(buildGeminiContents({ text: 'Describe this image' }), [{ role: 'user', parts: [{ text: 'Describe this image' }] }]);
assert.throws(() => normalizePart({ inlineData: { mimeType: 'application/x-bad', data: 'abc' } }), /multimodal_mime_unsupported/);
assert.throws(() => normalizePart({ fileData: { mimeType: 'image/png', fileUri: 'http://insecure' } }), /multimodal_file_uri_invalid/);
assert.throws(() => normalizePart({ text: 'Bearer ABCDEFGHIJKLMNOP' }), /secret_material_rejected/);

const image = buildGeminiContents({
  text: 'What is visible?',
  parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }]
});
assert.equal(image[0].parts.length, 2);
assert.equal(image[0].parts[1].inlineData.mimeType, 'image/png');

const documentState = fromPerceptionState({
  modality: 'document',
  content_type: 'document',
  source_ref: 'https://example.com/doc.pdf',
  document_text: 'A report'
});
assert.equal(documentState[0].parts.some(part => part.text === 'A report'), true);
assert.equal(documentState[0].parts.some(part => part.fileData?.mimeType === 'application/pdf'), true);

console.log('MULTIMODAL GEMINI CONTENT V1: PASS');
