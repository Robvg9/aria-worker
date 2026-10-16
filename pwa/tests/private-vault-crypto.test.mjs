import test, { before } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  createVaultCrypto,
  decryptRecord,
  encryptRecord,
  rotateVaultCredentials,
  unlockVaultWithPassword,
  unlockVaultWithRecoveryKey,
} from "../src/privateVault/crypto.js";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "correct horse battery staple";
const NEXT_PASSWORD = "a different strong horse battery staple";
const FINAL_PASSWORD = "yet another strong password for vault";
let created;

before(async () => {
  created = await createVaultCrypto(VAULT_ID, PASSWORD);
});

test("vault uses the pinned Argon2id profile and stores only wrapped root-key material", () => {
  assert.equal(created.config.format_version, 1);
  assert.equal(created.config.kdf_id, "argon2id-v1.3");
  assert.deepEqual(created.config.kdf_params, { m: 65536, t: 3, p: 4 });
  assert.equal(created.config.kdf_salt.length, 22);
  assert.equal(created.config.password_wrap_nonce.length, 16);
  assert.equal(created.config.wrapped_vault_key.length, 64);
  assert.equal(created.config.recovery_wrap_nonce.length, 16);
  assert.equal(created.config.recovery_wrapped_vault_key.length, 64);
  assert.equal(Object.hasOwn(created.config, "password"), false);
  assert.equal(Object.hasOwn(created.config, "plaintext"), false);
  assert.equal(created.key.extractable, false);
  assert.equal(created.key.algorithm.name, "AES-GCM");
});

test("correct password and recovery key unlock the same vault key", async () => {
  const byPassword = await unlockVaultWithPassword(VAULT_ID, created.config, PASSWORD);
  const byRecovery = await unlockVaultWithRecoveryKey(VAULT_ID, created.config, created.recoveryKey);
  const record = { title: "synthetic title", content: "synthetic secret note", createdAt: "2026-10-16T00:00:00.000Z" };
  const sealed = await encryptRecord({ vaultId: VAULT_ID, recordId: RECORD_ID, revision: 1, key: byPassword, value: record });
  assert.equal(Object.hasOwn(sealed, "plaintext"), false);
  assert.deepEqual(await decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 1, key: byPassword,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }), record);
  assert.deepEqual(await decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 1, key: byRecovery,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }), record);
});

test("wrong password is rejected by authenticated decryption", async () => {
  await assert.rejects(
    unlockVaultWithPassword(VAULT_ID, created.config, "incorrect password that is long enough"),
  );
});

test("tampered ciphertext and wrong record context are rejected", async () => {
  const sealed = await encryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 1, key: created.key,
    value: { title: "tamper fixture", content: "synthetic payload" },
  });
  const index = 0;
  const tampered = (sealed.ciphertext[index] === "A" ? "B" : "A") + sealed.ciphertext.slice(1);
  await assert.rejects(decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 1, key: created.key,
    payloadNonce: sealed.payload_nonce, ciphertext: tampered,
  }));
  await assert.rejects(decryptRecord({
    vaultId: VAULT_ID, recordId: "33333333-3333-4333-8333-333333333333", revision: 1, key: created.key,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }));
  await assert.rejects(decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 2, key: created.key,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }));
});

test("rotation with password and recovery key rewraps the same root key", async () => {
  const firstRotation = await rotateVaultCredentials(VAULT_ID, created.config, { type: "password", secret: PASSWORD }, NEXT_PASSWORD);
  await assert.rejects(unlockVaultWithPassword(VAULT_ID, firstRotation.config, PASSWORD));
  const byNewPassword = await unlockVaultWithPassword(VAULT_ID, firstRotation.config, NEXT_PASSWORD);
  const byNewRecovery = await unlockVaultWithRecoveryKey(VAULT_ID, firstRotation.config, firstRotation.recoveryKey);
  const secondRotation = await rotateVaultCredentials(VAULT_ID, firstRotation.config, {
    type: "recovery", secret: firstRotation.recoveryKey,
  }, FINAL_PASSWORD);
  await assert.rejects(unlockVaultWithPassword(VAULT_ID, secondRotation.config, NEXT_PASSWORD));
  const finalKey = await unlockVaultWithPassword(VAULT_ID, secondRotation.config, FINAL_PASSWORD);
  const sealed = await encryptRecord({ vaultId: VAULT_ID, recordId: RECORD_ID, revision: 7, key: byNewPassword, value: { title: "rotation", content: "root remains stable" } });
  assert.deepEqual(await decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 7, key: byNewRecovery,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }), { title: "rotation", content: "root remains stable" });
  assert.deepEqual(await decryptRecord({
    vaultId: VAULT_ID, recordId: RECORD_ID, revision: 7, key: finalKey,
    payloadNonce: sealed.payload_nonce, ciphertext: sealed.ciphertext,
  }), { title: "rotation", content: "root remains stable" });
  assert.notEqual(secondRotation.recoveryKey, firstRotation.recoveryKey);
});

test("records over the 1 MiB plaintext bound are rejected before network use", async () => {
  await assert.rejects(encryptRecord({
    vaultId: VAULT_ID,
    recordId: RECORD_ID,
    revision: 1,
    key: created.key,
    value: { title: "oversize", content: "x".repeat(1024 * 1024 + 128) },
  }), /1 MiB/);
});
