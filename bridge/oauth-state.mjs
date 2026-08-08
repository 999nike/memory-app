import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_VERSION = 1;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

class PersistedMap extends Map {
  constructor(entries, onChange) {
    super();
    this.onChange = onChange;
    for (const [key, value] of entries || []) Map.prototype.set.call(this, key, value);
  }

  set(key, value) {
    super.set(key, value);
    this.onChange?.();
    return this;
  }

  delete(key) {
    const changed = super.delete(key);
    if (changed) this.onChange?.();
    return changed;
  }

  clear() {
    if (!this.size) return;
    super.clear();
    this.onChange?.();
  }
}

function resolveStateFile() {
  const configured = String(process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(MODULE_DIR, '.state', 'oauth-state.enc.json');
}

function deriveKey(pairingToken, salt) {
  return crypto.scryptSync(String(pairingToken), salt, 32);
}

function encryptPayload(payload, pairingToken) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(pairingToken, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    version: STATE_VERSION,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: ciphertext.toString('base64url')
  };
}

function decryptEnvelope(envelope, pairingToken) {
  if (!envelope || Number(envelope.version) !== STATE_VERSION) {
    throw new Error('Unsupported OAuth state version');
  }
  if (envelope.kdf !== 'scrypt' || envelope.cipher !== 'aes-256-gcm') {
    throw new Error('Unsupported OAuth state encryption');
  }

  const salt = Buffer.from(String(envelope.salt || ''), 'base64url');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64url');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64url');
  const data = Buffer.from(String(envelope.data || ''), 'base64url');
  const key = deriveKey(pairingToken, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function validEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string');
}

function activeTokenEntries(value) {
  const now = Date.now();
  return validEntries(value).filter(([, record]) =>
    record && typeof record === 'object' && Number(record.expiresAt || 0) > now
  );
}

export function createPersistentOAuthState({ issuer, pairingToken, clientId }) {
  const stateFile = resolveStateFile();
  let restored = { dynamicClients: [], accessTokens: [], refreshTokens: [], connections: [] };

  try {
    if (fs.existsSync(stateFile)) {
      const envelope = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const payload = decryptEnvelope(envelope, pairingToken);
      if (payload.issuer !== issuer || payload.clientId !== clientId) {
        throw new Error('OAuth state belongs to a different bridge identity');
      }
      restored = {
        dynamicClients: validEntries(payload.dynamicClients),
        accessTokens: activeTokenEntries(payload.accessTokens),
        refreshTokens: activeTokenEntries(payload.refreshTokens),
        connections: validEntries(payload.connections)
      };
      console.log(
        `[oauth] state restored clients=${restored.dynamicClients.length} access=${restored.accessTokens.length} refresh=${restored.refreshTokens.length} connections=${restored.connections.length}`
      );
    }
  } catch (error) {
    console.warn(`[oauth] state restore skipped ${error?.message || error}`);
  }

  let saveQueued = false;
  let dynamicClients;
  let accessTokens;
  let refreshTokens;
  let connections;

  function saveNow() {
    try {
      const payload = {
        version: STATE_VERSION,
        issuer,
        clientId,
        savedAt: new Date().toISOString(),
        dynamicClients: [...dynamicClients.entries()],
        accessTokens: [...accessTokens.entries()],
        refreshTokens: [...refreshTokens.entries()],
        connections: [...connections.entries()]
      };
      const envelope = encryptPayload(payload, pairingToken);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tempFile = `${stateFile}.${process.pid}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempFile, stateFile);
      try { fs.chmodSync(stateFile, 0o600); } catch {}
    } catch (error) {
      console.error(`[oauth] state save failed ${error?.message || error}`);
    }
  }

  function scheduleSave() {
    if (saveQueued) return;
    saveQueued = true;
    queueMicrotask(() => {
      saveQueued = false;
      saveNow();
    });
  }

  dynamicClients = new PersistedMap(restored.dynamicClients, scheduleSave);
  accessTokens = new PersistedMap(restored.accessTokens, scheduleSave);
  refreshTokens = new PersistedMap(restored.refreshTokens, scheduleSave);
  connections = new PersistedMap(restored.connections, scheduleSave);

  return Object.freeze({
    stateFile,
    dynamicClients,
    accessTokens,
    refreshTokens,
    connections,
    flush: saveNow
  });
}
