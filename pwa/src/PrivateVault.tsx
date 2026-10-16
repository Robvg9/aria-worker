import { useEffect, useState } from "react";
import {
  createVaultCrypto,
  decryptRecord,
  encryptRecord,
  rotateVaultCredentials,
  unlockVaultWithPassword,
  unlockVaultWithRecoveryKey,
} from "./privateVault/crypto.js";

type VaultConfig = {
  vault_id: string;
  format_version: 1;
  kdf_id: "argon2id-v1.3";
  kdf_params: { m: 65536; t: 3; p: 4 };
  kdf_salt: string;
  password_wrap_nonce: string;
  wrapped_vault_key: string;
  recovery_wrap_nonce: string;
  recovery_wrapped_vault_key: string;
  created_at?: string;
  updated_at?: string;
};
type VaultRecordView = { recordId: string; revision: number; title: string; content: string; createdAt?: string };

const API_BASE = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-private-vault-v1";
const MAX_VISIBLE_RECORDS = 15;
const AUTO_LOCK_MS = 5 * 60 * 1000;

async function apiRequest(path: string, token: string, publishableKey: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + token);
  headers.set("apikey", publishableKey);
  headers.set("content-type", "application/json");
  const response = await fetch(API_BASE + path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "omit",
  });
  const raw = await response.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const code = String(body?.error ?? "vault_api_error");
    if (response.status === 401) throw new Error("La sesión de ARIA ya no está autorizada. Renueva la sesión antes de continuar.");
    if (response.status === 404) throw new Error("La API de la bóveda todavía no está desplegada o el recurso no existe.");
    if (response.status === 429) throw new Error("Límite temporal de la bóveda alcanzado. Espera antes de repetir la operación.");
    if (response.status >= 500) throw new Error("La API de la bóveda no está disponible. No se ha confirmado ningún cambio.");
    throw new Error("La API rechazó la operación (" + code + ").");
  }
  return body;
}

function humanDate(value?: string) {
  if (!value) return "Fecha no disponible";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(time)) : "Fecha no disponible";
}

function isSecretKey(value: unknown): value is CryptoKey {
  return Boolean(value && typeof value === "object" && (value as CryptoKey).type === "secret" &&
    (value as CryptoKey).extractable === false && (value as CryptoKey).algorithm?.name === "AES-GCM");
}

type PendingRecovery = {
  kind: "create" | "rotate";
  vaultId: string;
  config: any;
  key: CryptoKey;
  recoveryKey: string;
};

export function PrivateVault({ token, publishableKey }: { token: string; publishableKey: string }) {
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [records, setRecords] = useState<VaultRecordView[]>([]);
  const [apiReady, setApiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPassword, setCreatePassword] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");
  const [unlockMethod, setUnlockMethod] = useState<"password" | "recovery">("password");
  const [unlockSecret, setUnlockSecret] = useState("");
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecovery | null>(null);
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [rotationMethod, setRotationMethod] = useState<"password" | "recovery">("password");
  const [rotationSecret, setRotationSecret] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [rotationOpen, setRotationOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  const selectedVault = vaults.find(vault => vault.vault_id === vaultId) ?? null;
  const isUnlocked = isSecretKey(key);

  async function refreshVaults() {
    const data = await apiRequest("/vaults?limit=50&offset=0", token, publishableKey);
    if (!Array.isArray(data?.vaults)) throw new Error("La API devolvió una lista de bóvedas no válida.");
    setVaults(data.vaults as VaultConfig[]);
    setApiReady(true);
    if (data.vaults.length && !data.vaults.some((item: VaultConfig) => item.vault_id === vaultId)) {
      setVaultId(String(data.vaults[0].vault_id));
    }
    return data.vaults as VaultConfig[];
  }

  useEffect(() => {
    let alive = true;
    setBusy(true);
    apiRequest("/vaults?limit=50&offset=0", token, publishableKey)
      .then(data => {
        if (!alive) return;
        if (!Array.isArray(data?.vaults)) throw new Error("La API devolvió una lista de bóvedas no válida.");
        setVaults(data.vaults as VaultConfig[]);
        setApiReady(true);
        if (data.vaults.length) setVaultId(String(data.vaults[0].vault_id));
        setError("");
      })
      .catch(reason => {
        if (!alive) return;
        setApiReady(false);
        setError(reason instanceof Error ? reason.message : "La API de la bóveda no está disponible.");
      })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    // Initial connectivity check only; credential refresh creates a new component session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function lockVault(showMessage = true) {
    setKey(null);
    setRecords([]);
    setUnlockSecret("");
    setRotationSecret("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setNoteTitle("");
    setNoteContent("");
    setRotationOpen(false);
    setPendingRecovery(null);
    setRecoveryConfirm("");
    if (showMessage) setMessage("Bóveda bloqueada. La clave permanecía solo en memoria.");
  }

  useEffect(() => {
    if (!key) return;
    let timer = window.setTimeout(() => lockVault(), AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lockVault(), AUTO_LOCK_MS);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") lockVault();
      else reset();
    };
    window.addEventListener("pointerdown", reset, { passive: true });
    window.addEventListener("keydown", reset);
    window.addEventListener("touchstart", reset, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("touchstart", reset);
      document.removeEventListener("visibilitychange", visibility);
    };
    // Any unlock creates a fresh inactivity/visibility lock timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, vaultId]);

  async function prepareCreate() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!apiReady) throw new Error("La API no está disponible; no se puede crear una bóveda de forma persistente.");
      if (createPassword !== createConfirm) throw new Error("Las dos contraseñas no coinciden.");
      const id = globalThis.crypto.randomUUID();
      const created = await createVaultCrypto(id, createPassword);
      setPendingRecovery({ kind: "create", vaultId: id, config: created.config, key: created.key, recoveryKey: created.recoveryKey });
      setRecoveryConfirm("");
      setMessage("Guarda la clave de recuperación fuera de ARIA y confírmala para guardar la configuración cifrada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo preparar la bóveda.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (!selectedVault) { setError("Selecciona una bóveda."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const unlockedKey = unlockMethod === "password"
        ? await unlockVaultWithPassword(selectedVault.vault_id, selectedVault, unlockSecret)
        : await unlockVaultWithRecoveryKey(selectedVault.vault_id, selectedVault, unlockSecret.trim());
      if (!isSecretKey(unlockedKey)) throw new Error("El desbloqueo no produjo una clave válida.");
      setKey(unlockedKey);
      setUnlockSecret("");
      const count = await loadRecords(selectedVault.vault_id, unlockedKey);
      setMessage("Bóveda desbloqueada localmente. " + count + " registro(s) descifrado(s) en este dispositivo.");
    } catch {
      setKey(null);
      setRecords([]);
      setError("No se pudo desbloquear: la contraseña/clave puede ser incorrecta o un registro puede estar alterado. No se ha enviado la clave al servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function loadRecords(forVaultId: string, unlockedKey: CryptoKey) {
    const listed = await apiRequest("/vaults/" + encodeURIComponent(forVaultId) + "/records?limit=100&offset=0", token, publishableKey);
    const metadata = Array.isArray(listed?.records) ? listed.records : [];
    const latestById = new Map<string, any>();
    for (const item of metadata) {
      const id = String(item?.record_id ?? "");
      const revision = Number(item?.revision);
      const previous = latestById.get(id);
      if (id && Number.isSafeInteger(revision) && revision > 0 && (!previous || revision > Number(previous.revision))) latestById.set(id, item);
    }
    const chosen = [...latestById.values()]
      .sort((a, b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")))
      .slice(0, MAX_VISIBLE_RECORDS);
    const next: VaultRecordView[] = [];
    for (const meta of chosen) {
      const detail = await apiRequest("/vaults/" + encodeURIComponent(forVaultId) + "/records/" +
        encodeURIComponent(String(meta.record_id)) + "?revision=" + encodeURIComponent(String(meta.revision)), token, publishableKey);
      const encrypted = detail?.record;
      if (!encrypted) throw new Error("La API devolvió un registro incompleto.");
      const clear = await decryptRecord({
        vaultId: forVaultId,
        recordId: String(meta.record_id),
        revision: Number(meta.revision),
        key: unlockedKey,
        payloadNonce: String(encrypted.payload_nonce),
        ciphertext: String(encrypted.ciphertext),
      });
      if (!clear || typeof clear.title !== "string" || typeof clear.content !== "string") {
        throw new Error("El registro cifrado no tiene el formato esperado.");
      }
      next.push({
        recordId: String(meta.record_id),
        revision: Number(meta.revision),
        title: clear.title,
        content: clear.content,
        createdAt: typeof clear.createdAt === "string" ? clear.createdAt : meta.created_at,
      });
    }
    setRecords(next);
    return next.length;
  }

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedVault || !isUnlocked || !key) return;
    setBusy(true); setError(""); setMessage("");
    const recordId = globalThis.crypto.randomUUID();
    try {
      const sealed = await encryptRecord({
        vaultId: selectedVault.vault_id,
        recordId,
        revision: 1,
        key,
        value: { title: noteTitle.trim(), content: noteContent, createdAt: new Date().toISOString() },
      });
      await apiRequest("/vaults/" + encodeURIComponent(selectedVault.vault_id) + "/records/" + encodeURIComponent(recordId), token, publishableKey, {
        method: "PUT",
        body: JSON.stringify({ format_version: 1, revision: 1, payload_nonce: sealed.payload_nonce, ciphertext: sealed.ciphertext }),
      });
      setNoteTitle(""); setNoteContent("");
      await loadRecords(selectedVault.vault_id, key);
      setMessage("Nota cifrada en este dispositivo y guardada como ciphertext. El servidor no recibió el título ni el contenido.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro cifrado.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareRotation(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedVault || !isUnlocked) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (newPassword !== newPasswordConfirm) throw new Error("Las nuevas contraseñas no coinciden.");
      const rotated = await rotateVaultCredentials(selectedVault.vault_id, selectedVault, {
        type: rotationMethod,
        secret: rotationMethod === "password" ? rotationSecret : rotationSecret.trim(),
      }, newPassword);
      setPendingRecovery({ kind: "rotate", vaultId: selectedVault.vault_id, config: rotated.config, key: rotated.key, recoveryKey: rotated.recoveryKey });
      setRecoveryConfirm("");
      setMessage("La nueva clave de recuperación se muestra una sola vez. Confírmala antes de cambiar la configuración del servidor.");
    } catch {
      setError("No se pudo rotar la clave: la credencial actual puede ser incorrecta. La configuración remota permanece sin cambios.");
    } finally {
      setBusy(false);
    }
  }

  async function persistPendingRecovery() {
    if (!pendingRecovery) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (recoveryConfirm !== pendingRecovery.recoveryKey) throw new Error("La confirmación no coincide con la clave de recuperación.");
      await apiRequest("/vaults/" + encodeURIComponent(pendingRecovery.vaultId), token, publishableKey, {
        method: "PUT",
        body: JSON.stringify(pendingRecovery.config),
      });
      await refreshVaults();
      setVaultId(pendingRecovery.vaultId);
      setKey(pendingRecovery.key);
      setRecords([]);
      setPendingRecovery(null);
      setRecoveryConfirm("");
      setCreatePassword(""); setCreateConfirm("");
      setRotationSecret(""); setNewPassword(""); setNewPasswordConfirm("");
      setCreateOpen(false); setRotationOpen(false);
      setMessage(pendingRecovery.kind === "create"
        ? "Configuración cifrada guardada. La clave está desbloqueada solo en memoria."
        : "Rotación guardada. Verifica que la nueva contraseña y clave de recuperación permiten desbloquear antes de migrar datos.");
      const activeKey = pendingRecovery.key;
      void loadRecords(pendingRecovery.vaultId, activeKey).catch(() => setError("La bóveda se guardó, pero no se pudo actualizar la lista de registros."));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la configuración de la bóveda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel privateVaultPanel" data-testid="aria-private-vault">
      <div className="panelTitle">🔐 BÓVEDA PRIVADA · CIFRADO DEL CLIENTE</div>
      <p className="muted">Argon2id + AES-256-GCM. Las notas se cifran antes de salir del dispositivo; la clave no se guarda en localStorage ni se envía a ARIA.</p>
      <div className="privateVaultSecurityNote" role="note">
        La API de bóveda todavía debe superar sus gates de integración y despliegue. Si no responde, esta pantalla no simula guardados ni conserva datos en local.
      </div>
      <div className="actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => {
          setBusy(true); setError(""); setMessage("");
          refreshVaults().then(() => setMessage("Estado de la API actualizado.")).catch(reason => { setApiReady(false); setError(reason instanceof Error ? reason.message : "API no disponible."); }).finally(() => setBusy(false));
        }}>Verificar API</button>
        {apiReady && <span className="pill">{vaults.length} bóveda(s) · API accesible</span>}
      </div>
      {!apiReady && <div className="errorBox">La API de bóveda no está lista o no respondió. No introduzcas datos reales aquí hasta comprobar el despliegue.</div>}
      {error && <div className="errorBox" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}

      {!pendingRecovery && (
        <>
          <div className="settingsOption">
            <div><strong>Seleccionar bóveda</strong><small>Los identificadores son opacos; no contienen títulos ni notas.</small></div>
            <select aria-label="Seleccionar bóveda privada" value={vaultId} disabled={!apiReady || busy || isUnlocked} onChange={event => setVaultId(event.target.value)}>
              {vaults.map(vault => <option key={vault.vault_id} value={vault.vault_id}>{vault.vault_id}</option>)}
            </select>
          </div>
          {!isUnlocked && (
            <>
              {vaults.length > 0 && (
                <form onSubmit={event => { event.preventDefault(); void unlock(); }}>
                  <div className="settingsOption">
                    <div><strong>Desbloqueo local</strong><small>La credencial se usa para descifrar en el dispositivo. Nunca se transmite al backend.</small></div>
                    <select aria-label="Método de desbloqueo" value={unlockMethod} onChange={event => setUnlockMethod(event.target.value as "password" | "recovery")} disabled={busy}>
                      <option value="password">Contraseña</option>
                      <option value="recovery">Clave de recuperación</option>
                    </select>
                  </div>
                  <label className="privateVaultField">
                    <span>{unlockMethod === "password" ? "Contraseña de bóveda" : "Clave de recuperación"}</span>
                    <input autoComplete="off" type="password" value={unlockSecret} onChange={event => setUnlockSecret(event.target.value)} required disabled={busy || !apiReady} />
                  </label>
                  <div className="actions"><button className="primary" type="submit" disabled={!apiReady || busy || !unlockSecret}>{busy ? "Comprobando…" : "Desbloquear"}</button></div>
                </form>
              )}
              <div className="privateVaultDivider" />
              <button type="button" className="ghost" disabled={!apiReady || busy} onClick={() => { setCreateOpen(value => !value); setError(""); setMessage(""); }}>
                {createOpen ? "Cancelar nueva bóveda" : "Crear bóveda"}
              </button>
              {createOpen && (
                <form onSubmit={event => { event.preventDefault(); void prepareCreate(); }}>
                  <label className="privateVaultField"><span>Nueva contraseña (mínimo 16 caracteres)</span><input type="password" autoComplete="new-password" minLength={16} value={createPassword} onChange={event => setCreatePassword(event.target.value)} required disabled={busy || !apiReady} /></label>
                  <label className="privateVaultField"><span>Repite la contraseña</span><input type="password" autoComplete="new-password" minLength={16} value={createConfirm} onChange={event => setCreateConfirm(event.target.value)} required disabled={busy || !apiReady} /></label>
                  <div className="actions"><button className="primary" type="submit" disabled={!apiReady || busy || createPassword.length < 16 || !createConfirm}>{busy ? "Preparando…" : "Generar bóveda y clave de recuperación"}</button></div>
                </form>
              )}
            </>
          )}
        </>
      )}

      {pendingRecovery && (
        <div className="privateVaultRecovery" role="group" aria-label="Confirmación de clave de recuperación">
          <h3>{pendingRecovery.kind === "create" ? "Guarda la clave de recuperación" : "Confirma la nueva clave de recuperación"}</h3>
          <p>Esta clave no se vuelve a mostrar después de confirmar. Guárdala fuera de ARIA, en un lugar seguro. Si pierdes la contraseña y esta clave, los datos cifrados podrían ser irrecuperables.</p>
          <code className="privateVaultRecoveryCode">{pendingRecovery.recoveryKey}</code>
          <label className="privateVaultField"><span>Vuelve a escribir la clave completa</span><input autoComplete="off" type="password" value={recoveryConfirm} onChange={event => setRecoveryConfirm(event.target.value)} required disabled={busy} /></label>
          <div className="actions">
            <button type="button" className="primary" disabled={busy || recoveryConfirm !== pendingRecovery.recoveryKey} onClick={() => void persistPendingRecovery()}>{busy ? "Guardando…" : "Confirmar y guardar"}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => { lockVault(false); setPendingRecovery(null); setRecoveryConfirm(""); setMessage("Operación cancelada antes de guardar; ninguna configuración remota cambió."); }}>Cancelar</button>
          </div>
        </div>
      )}

      {isUnlocked && selectedVault && (
        <>
          <div className="privateVaultUnlocked" role="status">
            <div><strong>Bóveda desbloqueada</strong><small>La clave es no extraíble y se mantiene en memoria. Bloqueo por inactividad: 5 minutos; al ocultar la app se bloquea inmediatamente.</small></div>
            <button type="button" className="ghost" onClick={() => lockVault()}>Bloquear ahora</button>
          </div>
          <form onSubmit={saveNote}>
            <h3>Nueva nota cifrada</h3>
            <label className="privateVaultField"><span>Título (solo dentro del ciphertext)</span><input value={noteTitle} onChange={event => setNoteTitle(event.target.value)} required maxLength={500} disabled={busy} /></label>
            <label className="privateVaultField"><span>Contenido (solo dentro del ciphertext)</span><textarea value={noteContent} onChange={event => setNoteContent(event.target.value)} required maxLength={1000000} rows={4} disabled={busy} /></label>
            <div className="actions"><button type="submit" className="primary" disabled={busy || !noteTitle.trim() || !noteContent.trim()}>{busy ? "Cifrando y guardando…" : "Cifrar y guardar nota"}</button></div>
          </form>
          <div className="privateVaultDivider" />
          <div className="privateVaultRecordHeader"><h3>Notas descifradas localmente</h3><span className="pill">{records.length}</span></div>
          {records.length
            ? records.map(record => <article className="privateVaultRecord" key={record.recordId + ":" + record.revision}>
                <div><strong>{record.title}</strong><small>{humanDate(record.createdAt)} · rev. {record.revision}</small></div>
                <p>{record.content}</p>
              </article>)
            : <div className="emptyState">No hay notas visibles en la primera página o no hay registros guardados.</div>}
          {vaults.length > 0 && <button type="button" className="ghost" disabled={busy} onClick={() => {
            setBusy(true); setError("");
            loadRecords(selectedVault.vault_id, key as CryptoKey).then(count => setMessage(count + " registro(s) cargados.")).catch(reason => setError(reason instanceof Error ? reason.message : "No se pudieron cargar los registros.")).finally(() => setBusy(false));
          }}>Actualizar notas</button>}
          <div className="privateVaultDivider" />
          <button type="button" className="ghost" disabled={busy} onClick={() => { setRotationOpen(value => !value); setError(""); }}>
            {rotationOpen ? "Cancelar rotación" : "Rotar contraseña y clave de recuperación"}
          </button>
          {rotationOpen && (
            <form onSubmit={prepareRotation}>
              <div className="settingsOption"><div><strong>Credencial actual</strong><small>La clave de recuperación permite reemplazar una contraseña olvidada.</small></div>
                <select value={rotationMethod} onChange={event => setRotationMethod(event.target.value as "password" | "recovery")} disabled={busy}>
                  <option value="password">Contraseña actual</option><option value="recovery">Clave de recuperación actual</option>
                </select>
              </div>
              <label className="privateVaultField"><span>{rotationMethod === "password" ? "Contraseña actual" : "Clave de recuperación actual"}</span><input type="password" autoComplete="off" value={rotationSecret} onChange={event => setRotationSecret(event.target.value)} required disabled={busy} /></label>
              <label className="privateVaultField"><span>Nueva contraseña (mínimo 16 caracteres)</span><input type="password" autoComplete="new-password" minLength={16} value={newPassword} onChange={event => setNewPassword(event.target.value)} required disabled={busy} /></label>
              <label className="privateVaultField"><span>Repite la nueva contraseña</span><input type="password" autoComplete="new-password" minLength={16} value={newPasswordConfirm} onChange={event => setNewPasswordConfirm(event.target.value)} required disabled={busy} /></label>
              <div className="actions"><button type="submit" className="primary" disabled={busy || !rotationSecret || newPassword.length < 16 || !newPasswordConfirm}>{busy ? "Rotando…" : "Generar nuevas envolturas"}</button></div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
