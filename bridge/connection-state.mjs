import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_VERSION = 1;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONNECTION_ID_RE = /^conn_[A-Za-z0-9_-]{8,80}$/;

function resolveStateFile() {
  const configured = String(process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(MODULE_DIR, '.state', 'customer-connections.enc.json');
}

function deriveKey(masterToken, salt) {
  return crypto.scryptSync(String(masterToken), salt, 32);
}

function encryptPayload(payload, masterToken) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(masterToken, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    version: STATE_VERSION,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url')
  };
}

function decryptPayload(envelope, masterToken) {
  if (!envelope || Number(envelope.version) !== STATE_VERSION) throw new Error('Unsupported connection state version');
  if (envelope.kdf !== 'scrypt' || envelope.cipher !== 'aes-256-gcm') throw new Error('Unsupported connection state encryption');
  const salt = Buffer.from(String(envelope.salt || ''), 'base64url');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64url');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64url');
  const data = Buffer.from(String(envelope.data || ''), 'base64url');
  const key = deriveKey(masterToken, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function legacyDerivedSecret(masterToken, connectionId) {
  return crypto
    .createHmac('sha256', String(masterToken))
    .update(`memory-space-connection:${connectionId}`)
    .digest('base64url');
}

function normalizeRecord(recordValue, masterToken, connectionId) {
  const record = recordValue && typeof recordValue === 'object' && !Array.isArray(recordValue)
    ? { ...recordValue }
    : {};
  let migrated = false;
  if (!String(record.secret || '').trim()) {
    record.secret = legacyDerivedSecret(masterToken, connectionId);
    migrated = true;
  }
  return { record, migrated };
}

function writeEnvelopeFile(stateFile, envelope) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, stateFile);
  try { fs.chmodSync(stateFile, 0o600); } catch {}
}

export function rotateConnectionStateMasterToken({ stateFile = resolveStateFile(), oldMasterToken, newMasterToken }) {
  if (!oldMasterToken || !newMasterToken) throw new Error('Old and new bridge administrator tokens are required');
  if (safeEqual(oldMasterToken, newMasterToken)) throw new Error('New bridge administrator token must be different');
  const resolved = path.resolve(stateFile);
  if (!fs.existsSync(resolved)) return { rotated: false, connectionCount: 0, stateFile: resolved };

  const payload = decryptPayload(JSON.parse(fs.readFileSync(resolved, 'utf8')), oldMasterToken);
  const connections = [];
  for (const item of Array.isArray(payload?.connections) ? payload.connections : []) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const connectionId = String(item[0] || '');
    if (!CONNECTION_ID_RE.test(connectionId)) continue;
    const { record } = normalizeRecord(item[1], oldMasterToken, connectionId);
    connections.push([connectionId, record]);
  }

  writeEnvelopeFile(resolved, encryptPayload({
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    connections
  }, newMasterToken));

  return { rotated: true, connectionCount: connections.length, stateFile: resolved };
}

export function createConnectionState({ masterToken, publicUrl, bridgeName = 'Memory Bridge' }) {
  if (!masterToken) throw new Error('Connection state requires the bridge administrator token');
  const publicBase = String(publicUrl || '').replace(/\/+$/, '');
  if (!publicBase.startsWith('https://')) throw new Error('Connection state requires the bridge public HTTPS URL');
  const stateFile = resolveStateFile();
  const records = new Map();
  let needsMigrationSave = false;

  try {
    if (fs.existsSync(stateFile)) {
      const payload = decryptPayload(JSON.parse(fs.readFileSync(stateFile, 'utf8')), masterToken);
      for (const item of Array.isArray(payload?.connections) ? payload.connections : []) {
        if (!Array.isArray(item) || item.length !== 2 || !CONNECTION_ID_RE.test(String(item[0] || ''))) continue;
        const connectionId = String(item[0]);
        const { record, migrated } = normalizeRecord(item[1], masterToken, connectionId);
        records.set(connectionId, record);
        if (migrated) needsMigrationSave = true;
      }
      console.log(`[bridge] customer connection state restored count=${records.size}`);
    }
  } catch (error) {
    console.warn(`[bridge] customer connection state restore skipped ${error?.message || error}`);
  }

  function save() {
    const envelope = encryptPayload({
      version: STATE_VERSION,
      savedAt: new Date().toISOString(),
      connections: [...records.entries()]
    }, masterToken);
    writeEnvelopeFile(stateFile, envelope);
  }

  if (needsMigrationSave) {
    save();
    console.log(`[bridge] customer connection credentials migrated to rotation-safe secrets count=${records.size}`);
  }

  function deriveSecret(connectionIdValue) {
    const connectionId = String(connectionIdValue || '');
    const record = records.get(connectionId);
    return record ? String(record.secret || '') : '';
  }

  function accessCodeFor(connectionIdValue) {
    const connectionId = String(connectionIdValue || '');
    const record = records.get(connectionId);
    if (!record) return null;
    const payload = {
      version: 2,
      name: record.name || bridgeName,
      baseUrl: `${publicBase}/c/${encodeURIComponent(connectionId)}`,
      connectionId,
      token: deriveSecret(connectionId)
    };
    return `MSB2.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
  }

  function exists(connectionIdValue) {
    return records.has(String(connectionIdValue || ''));
  }

  function create(nameValue = 'Private Memory Space') {
    let connectionId;
    do {
      connectionId = `conn_${crypto.randomBytes(12).toString('base64url')}`;
    } while (records.has(connectionId));
    const record = {
      name: String(nameValue || 'Private Memory Space').trim().slice(0, 120) || 'Private Memory Space',
      createdAt: new Date().toISOString(),
      secret: crypto.randomBytes(32).toString('base64url')
    };
    records.set(connectionId, record);
    save();
    return {
      connectionId,
      accessCode: accessCodeFor(connectionId),
      baseUrl: `${publicBase}/c/${encodeURIComponent(connectionId)}`,
      mcpEndpoint: `${publicBase}/c/${encodeURIComponent(connectionId)}/mcp`,
      name: record.name,
      createdAt: record.createdAt
    };
  }

  function list() {
    return [...records.entries()].map(([connectionId, record]) => ({
      connectionId,
      name: record?.name || 'Private Memory Space',
      createdAt: record?.createdAt || null
    }));
  }

  function verify(connectionIdValue, suppliedCredential) {
    const connectionId = String(connectionIdValue || '');
    if (!exists(connectionId)) return false;
    return safeEqual(accessCodeFor(connectionId), suppliedCredential) || safeEqual(deriveSecret(connectionId), suppliedCredential);
  }

  function credentialFor(connectionIdValue) {
    const connectionId = String(connectionIdValue || '');
    return exists(connectionId) ? accessCodeFor(connectionId) : null;
  }

  function revoke(connectionIdValue) {
    const connectionId = String(connectionIdValue || '').trim();
    if (!records.delete(connectionId)) return { connectionId, revoked: false };
    save();
    return { connectionId, revoked: true };
  }

  return Object.freeze({ stateFile, exists, create, list, verify, credentialFor, accessCodeFor, revoke });
}
