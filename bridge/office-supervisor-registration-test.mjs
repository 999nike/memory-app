import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnectionState } from './connection-state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePort = 22000 + (process.pid % 1000);
const bridgeBase = `http://127.0.0.1:${bridgePort}`;
const origin = 'http://127.0.0.1:8001';
const ownerToken = `owner-${crypto.randomBytes(24).toString('hex')}`;
const adminToken = `admin-${crypto.randomBytes(24).toString('hex')}`;
const supervisorCapability = crypto.randomBytes(32).toString('base64url');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-office-supervisor-'));
const capabilityFile = path.join(stateDir, 'service-capability');
fs.writeFileSync(capabilityFile, supervisorCapability, { mode: 0o600 });

let registration = null;
let registrationCount = 0;
const supervisor = http.createServer(async (request, response) => {
  if (request.url !== '/v1/office-source' || request.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  assert.equal(request.headers.origin, undefined);
  if (request.headers.authorization !== `Bearer ${supervisorCapability}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'supervisor_authorization_required' }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  registration = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  registrationCount += 1;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    authorised: true,
    supervisor: 'running',
    memorySource: 'authorised',
    sourceName: registration.sourceName,
    connectionId: registration.connectionId,
    authorisedAt: '2026-09-03T00:00:00.000Z',
    feedAvailable: true
  }));
});
await new Promise((resolve) => supervisor.listen(0, '127.0.0.1', resolve));
const supervisorBase = `http://127.0.0.1:${supervisor.address().port}`;

const child = spawn(process.execPath, [path.join(here, 'server.mjs')], {
  cwd: here,
  env: {
    ...process.env,
    MEMORY_BRIDGE_HOST: '127.0.0.1',
    MEMORY_BRIDGE_PORT: String(bridgePort),
    MEMORY_BRIDGE_TOKEN: ownerToken,
    MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
    MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
    MEMORY_BRIDGE_NAME: 'Supervisor Registration Test Bridge',
    MEMORY_BRIDGE_MODEL: 'test-model',
    MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
    MEMORY_BRIDGE_PUBLIC_URL: bridgeBase,
    MEMORY_BRIDGE_ORIGINS: origin,
    MEMORY_BRIDGE_CONNECTION_STATE_FILE: path.join(stateDir, 'connections.enc.json'),
    MEMORY_BRIDGE_TENANT_OAUTH_DIR: path.join(stateDir, 'tenant-oauth'),
    WIZZ_SUPERVISOR_URL: supervisorBase,
    WIZZ_SUPERVISOR_CAPABILITY_FILE: capabilityFile
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

async function json(url, options = {}) {
  const response = await fetch(url, options);
  return { response, data: await response.json().catch(() => ({})) };
}

async function waitForBridge() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const result = await json(`${bridgeBase}/v1/info`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start\n${logs}`);
}

async function createConnection(name) {
  const result = await json(`${bridgeBase}/v1/connections`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data;
}

function connectionUrl(connection, suffix) {
  return `${bridgeBase}/c/${encodeURIComponent(connection.connectionId)}${suffix}`;
}

function privateHeaders(connection) {
  return {
    Authorization: `Bearer ${connection.accessCode}`,
    'Content-Type': 'application/json',
    Origin: origin
  };
}

try {
  await waitForBridge();
  const alpha = await createConnection('Alpha');
  const beta = await createConnection('Beta');

  const authorised = await json(connectionUrl(alpha, '/v1/office/authorize'), {
    method: 'POST',
    headers: privateHeaders(alpha),
    body: '{}'
  });
  assert.equal(authorised.response.status, 200, JSON.stringify(authorised.data));
  assert.equal(authorised.data.authorised, true);
  assert.equal(authorised.data.connectionId, alpha.connectionId);
  assert.equal(authorised.data.feedAvailable, true);
  assert.equal(Object.hasOwn(authorised.data, 'feedUrl'), false);
  assert.equal(Object.hasOwn(authorised.data, 'token'), false);
  assert.equal(Object.hasOwn(authorised.data, 'feedToken'), false);
  assert.equal(registrationCount, 1);
  assert.equal(registration.connectionId, alpha.connectionId);
  assert.equal(new URL(registration.feedUrl).pathname, `/c/${alpha.connectionId}/v1/jobs`);
  assert.ok(registration.feedToken.length >= 16);
  assert.equal(JSON.stringify(authorised.data).includes(registration.feedToken), false);

  const badCredential = await json(connectionUrl(alpha, '/v1/office/authorize'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer wrong-private-credential',
      'Content-Type': 'application/json',
      Origin: origin
    },
    body: '{}'
  });
  assert.equal(badCredential.response.status, 401);
  assert.equal(registrationCount, 1);

  const crossedConnection = await json(connectionUrl(beta, '/v1/office/authorize'), {
    method: 'POST',
    headers: privateHeaders(alpha),
    body: '{}'
  });
  assert.equal(crossedConnection.response.status, 401);
  assert.equal(registrationCount, 1);

  const published = await json(connectionUrl(alpha, '/v1/workspace/snapshot'), {
    method: 'PUT',
    headers: privateHeaders(alpha),
    body: JSON.stringify({
      workspace: {
        version: 1,
        activeSpaceId: 'space_alpha',
        spaces: [{ id: 'space_alpha', name: 'Alpha Space' }],
        memories: []
      }
    })
  });
  assert.equal(published.response.status, 200);

  const ownFeed = await json(`${bridgeBase}/c/${alpha.connectionId}/v1/jobs/ready`, {
    headers: { Authorization: `Bearer ${registration.feedToken}` }
  });
  assert.equal(ownFeed.response.status, 200);

  const crossedFeed = await json(`${bridgeBase}/c/${beta.connectionId}/v1/jobs/ready`, {
    headers: { Authorization: `Bearer ${registration.feedToken}` }
  });
  assert.equal(crossedFeed.response.status, 401);
  assert.equal(logs.includes(registration.feedToken), false);

  const previousStateFile = process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE;
  process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = path.join(stateDir, 'url-validation.enc.json');
  try {
    assert.doesNotThrow(() => createConnectionState({
      masterToken: adminToken,
      publicUrl: 'https://bridge.w-i-z-z-lab-studios.com'
    }));
    assert.doesNotThrow(() => createConnectionState({
      masterToken: adminToken,
      publicUrl: 'http://127.0.0.1:8787'
    }));
    assert.throws(() => createConnectionState({
      masterToken: adminToken,
      publicUrl: 'http://192.168.1.8:8787'
    }), /HTTPS/);
  } finally {
    if (previousStateFile == null) delete process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE;
    else process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = previousStateFile;
  }

  console.log('PASS private Bridge authorization registers one scoped Office feed without exposing its secret.');
} finally {
  child.kill();
  await new Promise((resolve) => supervisor.close(resolve));
  fs.rmSync(stateDir, { recursive: true, force: true });
}
