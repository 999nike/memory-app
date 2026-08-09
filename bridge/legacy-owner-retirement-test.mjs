import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = 20000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const publicBase = 'https://bridge.test';
const oldDevelopmentToken = `old-development-${crypto.randomBytes(24).toString('base64url')}`;
const ownerToken = `ephemeral-owner-${crypto.randomBytes(24).toString('base64url')}`;
const adminToken = `admin-${crypto.randomBytes(24).toString('base64url')}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-owner-retirement-'));

function headers(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  cwd: HERE,
  env: {
    ...process.env,
    MEMORY_BRIDGE_HOST: '127.0.0.1',
    MEMORY_BRIDGE_PORT: String(port),
    MEMORY_BRIDGE_TOKEN: oldDevelopmentToken,
    MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
    MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
    MEMORY_BRIDGE_NAME: 'Owner Retirement Test Bridge',
    MEMORY_BRIDGE_MODEL: 'test-model',
    MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
    MEMORY_BRIDGE_PUBLIC_URL: publicBase,
    MEMORY_BRIDGE_OAUTH_CLIENT_ID: 'memory-space-grok',
    MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS: 'example.com',
    MEMORY_BRIDGE_ORIGINS: 'https://memory-app.example',
    MEMORY_BRIDGE_OAUTH_STATE_FILE: path.join(stateDir, 'oauth-state.enc.json'),
    MEMORY_BRIDGE_CONNECTION_STATE_FILE: path.join(stateDir, 'connections.enc.json'),
    MEMORY_BRIDGE_TENANT_OAUTH_DIR: path.join(stateDir, 'tenant-oauth')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

async function waitForBridge() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/v1/info`, { headers: headers(adminToken) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start\n${logs}`);
}

try {
  await waitForBridge();

  const staleOwner = await fetch(`${base}/v1/info`, { headers: headers(oldDevelopmentToken) });
  assert.equal(staleOwner.status, 401, 'retired development token must not authenticate after owner/admin split');

  const currentOwner = await fetch(`${base}/v1/info`, { headers: headers(ownerToken) });
  assert.equal(currentOwner.status, 200, 'current owner token must still reach the legacy owner route before final migration');

  const ownerCannotAdmin = await fetch(`${base}/v1/connections`, { headers: headers(ownerToken) });
  assert.equal(ownerCannotAdmin.status, 401, 'owner token must not inherit administrator customer-management rights');

  const create = await fetch(`${base}/v1/connections`, {
    method: 'POST',
    headers: headers(adminToken),
    body: JSON.stringify({ name: 'Private Owner Migration' })
  });
  const connection = await create.json();
  assert.equal(create.status, 201, JSON.stringify(connection));
  assert.match(connection.accessCode, /^MSB2\./);

  const privateInfo = await fetch(`${base}/c/${encodeURIComponent(connection.connectionId)}/v1/info`, {
    headers: headers(connection.accessCode)
  });
  assert.equal(privateInfo.status, 200, 'MSB2 customer/private route must remain usable while legacy owner is retired');

  console.log('PASS legacy owner retirement: stale development token failed; owner/admin remained split; MSB2 private route remained usable.');
} finally {
  child.kill('SIGTERM');
  fs.rmSync(stateDir, { recursive: true, force: true });
}
