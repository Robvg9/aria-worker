import { argon2id } from "hash-wasm";

export const VAULT_FORMAT_VERSION = 1;
export const VAULT_KDF_ID = "argon2id-v1.3";
export const VAULT_KDF_PARAMS = Object.freeze({ m: 65536, t: 3, p: 4 });
export const MAX_RECORD_PLAINTEXT_BYTES = 1024 * 1024;
const ROOT_KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function webCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error("Este entorno no ofrece Web Crypto seguro.");
  }
  return globalThis.crypto;
}

function assertVaultId(vaultId) {
  if (typeof vaultId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vaultId)) {
    throw new Error("Identificador de bóveda inválido.");
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || [...password].length < 16) {
    throw new Error("La contraseña de la bóveda debe tener al menos 16 caracteres.");
  }
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  webCrypto().getRandomValues(bytes);
  return bytes;
}

function wipe(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

function toBase64Url(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("Formato criptográfico inválido.");
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Formato criptográfico inválido.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    wipe(bytes);
    throw new Error("Longitud criptográfica inválida.");
  }
  return bytes;
}

function passwordWrapAad(vaultId) {
  return encoder.encode("aria-vault:v1:" + vaultId + ":password-wrap");
}

function recoveryWrapAad(vaultId) {
  return encoder.encode("aria-vault:v1:" + vaultId + ":recovery-wrap");
}

function recordAad(vaultId, recordId, revision) {
  assertVaultId(vaultId);
  if (typeof recordId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recordId)) {
    throw new Error("Identificador de registro inválido.");
  }
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Revisión inválida.");
  return encoder.encode("aria-vault:v1:" + vaultId + ":record:" + recordId + ":" + revision);
}

async function importAesKey(rawBytes) {
  return await webCrypto().subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function derivePasswordWrappingKey(password, salt) {
  validatePassword(password);
  const derived = await argon2id({
    password,
    salt,
    parallelism: VAULT_KDF_PARAMS.p,
    iterations: VAULT_KDF_PARAMS.t,
    memorySize: VAULT_KDF_PARAMS.m,
    hashLength: ROOT_KEY_BYTES,
    outputType: "binary",
  });
  try {
    return await importAesKey(derived);
  } finally {
    wipe(derived);
  }
}

async function seal(key, plaintext, nonce, aad) {
  const encrypted = await webCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
    key,
    plaintext,
  );
  return new Uint8Array(encrypted);
}

async function open(key, ciphertext, nonce, aad) {
  const clear = await webCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: GCM_TAG_BYTES * 8 },
    key,
    ciphertext,
  );
  return new Uint8Array(clear);
}

function validateConfig(vaultId, config) {
  assertVaultId(vaultId);
  if (!config || config.format_version !== VAULT_FORMAT_VERSION || config.kdf_id !== VAULT_KDF_ID ||
      config.kdf_params?.m !== VAULT_KDF_PARAMS.m ||
      config.kdf_params?.t !== VAULT_KDF_PARAMS.t ||
      config.kdf_params?.p !== VAULT_KDF_PARAMS.p) {
    throw new Error("Configuración de bóveda no compatible.");
  }
  fromBase64Url(config.kdf_salt, SALT_BYTES).fill(0);
  fromBase64Url(config.password_wrap_nonce, NONCE_BYTES).fill(0);
  fromBase64Url(config.wrapped_vault_key, ROOT_KEY_BYTES + GCM_TAG_BYTES).fill(0);
  fromBase64Url(config.recovery_wrap_nonce, NONCE_BYTES).fill(0);
  fromBase64Url(config.recovery_wrapped_vault_key, ROOT_KEY_BYTES + GCM_TAG_BYTES).fill(0);
}

async function buildConfigFromRoot(vaultId, rootBytes, password, recoveryBytes) {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const passwordNonce = randomBytes(NONCE_BYTES);
  const recoveryNonce = randomBytes(NONCE_BYTES);
  const passwordKey = await derivePasswordWrappingKey(password, salt);
  const recoveryKey = await importAesKey(recoveryBytes);
  try {
    const wrappedPassword = await seal(passwordKey, rootBytes, passwordNonce, passwordWrapAad(vaultId));
    const wrappedRecovery = await seal(recoveryKey, rootBytes, recoveryNonce, recoveryWrapAad(vaultId));
    return {
      format_version: VAULT_FORMAT_VERSION,
      kdf_id: VAULT_KDF_ID,
      kdf_params: { ...VAULT_KDF_PARAMS },
      kdf_salt: toBase64Url(salt),
      password_wrap_nonce: toBase64Url(passwordNonce),
      wrapped_vault_key: toBase64Url(wrappedPassword),
      recovery_wrap_nonce: toBase64Url(recoveryNonce),
      recovery_wrapped_vault_key: toBase64Url(wrappedRecovery),
    };
  } finally {
    wipe(salt);
    wipe(passwordNonce);
    wipe(recoveryNonce);
  }
}

async function unwrapRootWithPassword(vaultId, config, password) {
  validateConfig(vaultId, config);
  const salt = fromBase64Url(config.kdf_salt, SALT_BYTES);
  const nonce = fromBase64Url(config.password_wrap_nonce, NONCE_BYTES);
  const wrapped = fromBase64Url(config.wrapped_vault_key, ROOT_KEY_BYTES + GCM_TAG_BYTES);
  try {
    const key = await derivePasswordWrappingKey(password, salt);
    return await open(key, wrapped, nonce, passwordWrapAad(vaultId));
  } finally {
    wipe(salt);
    wipe(nonce);
    wipe(wrapped);
  }
}

async function unwrapRootWithRecovery(vaultId, config, recoveryKey) {
  validateConfig(vaultId, config);
  const rawRecovery = fromBase64Url(recoveryKey, ROOT_KEY_BYTES);
  const nonce = fromBase64Url(config.recovery_wrap_nonce, NONCE_BYTES);
  const wrapped = fromBase64Url(config.recovery_wrapped_vault_key, ROOT_KEY_BYTES + GCM_TAG_BYTES);
  try {
    const key = await importAesKey(rawRecovery);
    return await open(key, wrapped, nonce, recoveryWrapAad(vaultId));
  } finally {
    wipe(rawRecovery);
    wipe(nonce);
    wipe(wrapped);
  }
}

export async function createVaultCrypto(vaultId, password) {
  assertVaultId(vaultId);
  validatePassword(password);
  const rootBytes = randomBytes(ROOT_KEY_BYTES);
  const recoveryBytes = randomBytes(ROOT_KEY_BYTES);
  try {
    const config = await buildConfigFromRoot(vaultId, rootBytes, password, recoveryBytes);
    const key = await importAesKey(rootBytes);
    return { vaultId, config, key, recoveryKey: toBase64Url(recoveryBytes) };
  } finally {
    wipe(rootBytes);
    wipe(recoveryBytes);
  }
}

export async function unlockVaultWithPassword(vaultId, config, password) {
  const rootBytes = await unwrapRootWithPassword(vaultId, config, password);
  try {
    return await importAesKey(rootBytes);
  } finally {
    wipe(rootBytes);
  }
}

export async function unlockVaultWithRecoveryKey(vaultId, config, recoveryKey) {
  const rootBytes = await unwrapRootWithRecovery(vaultId, config, recoveryKey);
  try {
    return await importAesKey(rootBytes);
  } finally {
    wipe(rootBytes);
  }
}

export async function rotateVaultCredentials(vaultId, config, credential, newPassword) {
  validatePassword(newPassword);
  if (!credential || !["password", "recovery"].includes(credential.type)) {
    throw new Error("Selecciona una credencial válida para la rotación.");
  }
  const rootBytes = credential.type === "password"
    ? await unwrapRootWithPassword(vaultId, config, credential.secret)
    : await unwrapRootWithRecovery(vaultId, config, credential.secret);
  const nextRecoveryBytes = randomBytes(ROOT_KEY_BYTES);
  try {
    const nextConfig = await buildConfigFromRoot(vaultId, rootBytes, newPassword, nextRecoveryBytes);
    const key = await importAesKey(rootBytes);
    return { vaultId, config: nextConfig, key, recoveryKey: toBase64Url(nextRecoveryBytes) };
  } finally {
    wipe(rootBytes);
    wipe(nextRecoveryBytes);
  }
}

export async function encryptRecord({ vaultId, recordId, revision, key, value }) {
  if (!key || key.type !== "secret" || key.extractable !== false) {
    throw new Error("La bóveda no está desbloqueada con una clave válida.");
  }
  const clear = encoder.encode(JSON.stringify(value));
  if (clear.byteLength === 0 || clear.byteLength > MAX_RECORD_PLAINTEXT_BYTES) {
    wipe(clear);
    throw new Error("La nota supera el límite de 1 MiB o está vacía.");
  }
  const nonce = randomBytes(NONCE_BYTES);
  try {
    const ciphertext = await seal(key, clear, nonce, recordAad(vaultId, recordId, revision));
    return { payload_nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };
  } finally {
    wipe(clear);
    wipe(nonce);
  }
}

export async function decryptRecord({ vaultId, recordId, revision, key, payloadNonce, ciphertext }) {
  if (!key || key.type !== "secret" || key.extractable !== false) {
    throw new Error("La bóveda está bloqueada.");
  }
  const nonce = fromBase64Url(payloadNonce, NONCE_BYTES);
  const sealed = fromBase64Url(ciphertext);
  let clear;
  try {
    clear = await open(key, sealed, nonce, recordAad(vaultId, recordId, revision));
    if (clear.byteLength > MAX_RECORD_PLAINTEXT_BYTES) throw new Error("Registro cifrado fuera del límite permitido.");
    return JSON.parse(decoder.decode(clear));
  } finally {
    wipe(nonce);
    wipe(sealed);
    if (clear) wipe(clear);
  }
}
