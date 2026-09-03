import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOST = '127.0.0.1';
export const PORT = 8790;
export const BASE = `http://${HOST}:${PORT}`;
export const STATE_DIR = path.resolve(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'WIZZ',
  'supervisor',
);
export const CAPABILITY_FILE = path.join(STATE_DIR, 'service-capability');
export const STATE_FILE = path.join(STATE_DIR, 'office-source.enc.json');

function ensurePrivateDirectory(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
}

function writePrivateFile(file, value) {
  ensurePrivateDirectory(file);
  fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 });
}

export function ensureCapability(file = CAPABILITY_FILE) {
  try {
    const current = fs.readFileSync(file, 'utf8').trim();
    if (current.length >= 43) return current;
  } catch {
    // Generate the service capability below.
  }
  ensurePrivateDirectory(file);
  const capability = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, capability, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return capability;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const current = fs.readFileSync(file, 'utf8').trim();
    if (current.length < 43) throw new Error('Invalid WIZZ Supervisor capability file');
    return current;
  }
}

export function readCapability(file = CAPABILITY_FILE) {
  const capability = fs.readFileSync(file, 'utf8').trim();
  if (capability.length < 43) throw new Error('Invalid WIZZ Supervisor capability file');
  return capability;
}

function encryptionKey(capability) {
  return crypto.createHash('sha256').update(capability).digest();
}

export function saveSource(source, capability, file = STATE_FILE) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(capability), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(source), 'utf8'),
    cipher.final(),
  ]);
  const envelope = JSON.stringify({
    version: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  });
  ensurePrivateDirectory(file);
  const temporary = `${file}.${process.pid}.tmp`;
  writePrivateFile(temporary, envelope);
  fs.renameSync(temporary, file);
}

export function loadSource(capability, file = STATE_FILE) {
  try {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (envelope.version !== 1) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(capability),
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}
