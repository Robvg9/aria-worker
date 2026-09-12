'use strict';

const VERSION = 'aria-multimodal-gemini-content-v1';
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
  'application/pdf', 'text/plain'
]);
const MAX_TEXT = 64 * 1024;
const MAX_URI = 8 * 1024 * 1024;

function containsSecretLike(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /(?:Bearer\s+[A-Za-z0-9._-]{16,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,})/i.test(text);
}

function normalizePart(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) throw new TypeError('multimodal_part_invalid');
  if (containsSecretLike(part)) throw new Error('secret_material_rejected');
  if (typeof part.text === 'string') {
    if (!part.text.trim() || part.text.length > MAX_TEXT) throw new Error('multimodal_text_invalid');
    return Object.freeze({ text: part.text });
  }
  if (part.inlineData && typeof part.inlineData === 'object') {
    const mime = String(part.inlineData.mimeType || '');
    const data = String(part.inlineData.data || '');
    if (!ALLOWED_MIME.has(mime)) throw new Error('multimodal_mime_unsupported');
    if (!data || data.length > MAX_URI) throw new Error('multimodal_inline_data_invalid');
    return Object.freeze({ inlineData: Object.freeze({ mimeType: mime, data }) });
  }
  if (part.fileData && typeof part.fileData === 'object') {
    const mime = String(part.fileData.mimeType || '');
    const uri = String(part.fileData.fileUri || '');
    if (!ALLOWED_MIME.has(mime)) throw new Error('multimodal_mime_unsupported');
    if (!/^https:\/\//i.test(uri) || uri.length > MAX_URI) throw new Error('multimodal_file_uri_invalid');
    return Object.freeze({ fileData: Object.freeze({ mimeType: mime, fileUri: uri }) });
  }
  throw new TypeError('multimodal_part_unsupported');
}

function buildGeminiContents({ text = null, parts = [], role = 'user' } = {}) {
  if (role !== 'user' && role !== 'model') throw new TypeError('multimodal_role_invalid');
  const normalized = [];
  if (typeof text === 'string' && text.trim()) normalized.push({ text });
  if (!Array.isArray(parts)) throw new TypeError('multimodal_parts_invalid');
  for (const part of parts) normalized.push(normalizePart(part));
  if (!normalized.length) throw new Error('multimodal_content_empty');
  return Object.freeze([{ role, parts: Object.freeze(normalized) }]);
}

function fromPerceptionState(state) {
  if (!state || typeof state !== 'object') throw new TypeError('perception_state_invalid');
  if (containsSecretLike(state)) throw new Error('secret_material_rejected');
  const parts = [];
  if (state.transcript) parts.push({ text: state.transcript });
  if (state.document_text) parts.push({ text: state.document_text });
  for (const observation of Array.isArray(state.observations) ? state.observations : []) {
    parts.push({ text: String(observation) });
  }
  if (state.source_ref && /^https:\/\//i.test(String(state.source_ref))) {
    const type = state.content_type || null;
    if (type === 'image') parts.push({ fileData: { mimeType: 'image/jpeg', fileUri: String(state.source_ref) } });
    if (type === 'document') parts.push({ fileData: { mimeType: 'application/pdf', fileUri: String(state.source_ref) } });
    if (type === 'audio') parts.push({ fileData: { mimeType: 'audio/mpeg', fileUri: String(state.source_ref) } });
  }
  return buildGeminiContents({ parts });
}

module.exports = Object.freeze({ VERSION, ALLOWED_MIME, normalizePart, buildGeminiContents, fromPerceptionState });
