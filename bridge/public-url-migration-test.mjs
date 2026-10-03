import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createPersistentOAuthState } from './oauth-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = 24000 + (process.pid % 1000);
const localBase = `http://127.0.0.1:${port}`;
const publicBase = 'https://bridge.w-i-z-z-lab-studios.com';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-public-url-'));
const connectionStateFile = path.join(stateDir, 'connections.enc.json');
const tenantOauthDir = path.join(stateDir, 'tenant-oauth');
const ownerOauthStateFile = path.join(stateDir, 'owner-oauth.enc.json');
const adminToken = `admin-${crypto.randomBytes(24).toString('base64url')}`;
const ownerToken = `owner-${crypto.randomBytes(24).toString('base64url')}`;
const clientId = 'memory-space-grok';
const redirectHost = 'example.com';
const bridgeName = 'Public URL Migration Test Bridge';
const customers = [
  syntheticCustomer('Alpha'),
  syntheticCustomer('Beta')
];

function syntheticCustomer(name) {
  return {
    connectionId: `conn_${crypto.randomBytes(12).toString('base64url')}`,
    record: {
      name,
      createdAt: new Date().toISOString(),
      secret: crypto.randomBytes(32).toString('base64url')
    }
  };
}

function accessCode(customer, baseUrl = localBase) {
  return `MSB2.${Buffer.from(JSON.stringify({
    version: 2,
    name: customer.record.name,
    baseUrl: `${baseUrl}/c/${encodeURIComponent(customer.connectionId)}`,
    connectionId: customer.connectionId,
    token: customer.record.secret
  }), 'utf8').toString('base64url')}`;
}

function writeLegacyConnectionState() {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(adminToken, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    connections: customers.map((customer) => [customer.connectionId, customer.record])
  };
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  fs.writeFileSync(connectionStateFile, JSON.stringify({
    version: 1,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url')
  }));
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function form(values) {
  return new URLSearchParams(values);
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url')
  };
}

function scopedPath(customer, suffix = '') {
  return `/c/${encodeURIComponent(customer.connectionId)}${suffix}`;
}

async function startBridge(advertisedUrl) {
  const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
    cwd: HERE,
    env: {
      ...process.env,
      MEMORY_BRIDGE_HOST: '127.0.0.1',
      MEMORY_BRIDGE_PORT: String(port),
      MEMORY_BRIDGE_TOKEN: ownerToken,
      MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
      MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
      MEMORY_BRIDGE_NAME: bridgeName,
      MEMORY_BRIDGE_MODEL: 'test-model',
      MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
      MEMORY_BRIDGE_PUBLIC_URL: advertisedUrl,
      MEMORY_BRIDGE_OAUTH_CLIENT_ID: clientId,
      MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS: redirectHost,
      MEMORY_BRIDGE_ORIGINS: 'https://memory-app.example',
      MEMORY_BRIDGE_OAUTH_STATE_FILE: ownerOauthStateFile,
      MEMORY_BRIDGE_CONNECTION_STATE_FILE: connectionStateFile,
      MEMORY_BRIDGE_TENANT_OAUTH_DIR: tenantOauthDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Bridge exited during startup\n${logs}`);
    try {
      const response = await fetch(`${localBase}/v1/info`, { headers: bearer(adminToken) });
      if (response.ok) return { child, logs: () => logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  child.kill('SIGTERM');
  throw new Error(`Bridge did not start\n${logs}`);
}

async function stopBridge(runtime) {
  if (runtime.child.exitCode != null) return;
  runtime.child.kill('SIGTERM');
  await once(runtime.child, 'exit');
}

async function json(responsePromise) {
  const response = await responsePromise;
  return { response, data: await response.json() };
}

async function register(customer, label) {
  const redirectUri = `https://${redirectHost}/${label.toLowerCase()}/callback`;
  const { response, data } = await json(fetch(`${localBase}${scopedPath(customer, '/register')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: label,
      application_type: 'web'
    })
  }));
  assert.equal(response.status, 201, JSON.stringify(data));
  return { clientId: data.client_id, redirectUri };
}

async function authorize(customer, client) {
  const { verifier, challenge } = pkce();
  const request = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'memory.read memory.propose',
    state: 'public-url-migration-test'
  };
  const page = await fetch(`${localBase}${scopedPath(customer, '/authorize')}?${form(request)}`);
  assert.equal(page.status, 200, await page.text());

  const approval = await fetch(`${localBase}${scopedPath(customer, '/authorize')}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(request)
  });
  assert.equal(approval.status, 302, await approval.text());
  const code = new URL(approval.headers.get('location')).searchParams.get('code');
  assert.ok(code);

  const { response, data } = await json(fetch(`${localBase}${scopedPath(customer, '/token')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_verifier: verifier
    })
  }));
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.access_token);
  assert.ok(data.refresh_token);
  return data;
}

async function jobFeedToken(customer) {
  const { response, data } = await json(fetch(`${localBase}${scopedPath(customer, '/v1/jobs/access')}`, {
    method: 'POST',
    headers: bearer(accessCode(customer))
  }));
  assert.equal(response.status, 200, JSON.stringify(data));
  return data.token;
}

async function initializeMcp(customer, token) {
  return fetch(`${localBase}${scopedPath(customer, '/mcp')}`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'migration-test', version: '1.0.0' }
      }
    })
  });
}

function transitionRestores(sourceIssuer, targetIssuer, pairingToken, label) {
  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = path.join(stateDir, `${label}.enc.json`);
  const source = createPersistentOAuthState({ issuer: sourceIssuer, pairingToken, clientId });
  source.dynamicClients.set('preserved-client', { clientName: 'Synthetic', createdAt: Date.now() });
  source.flush();
  const target = createPersistentOAuthState({ issuer: targetIssuer, pairingToken, clientId });
  return target.dynamicClients.has('preserved-client');
}

let runtime;
try {
  writeLegacyConnectionState();

  runtime = await startBridge(localBase);
  const preMigrationClient = await register(customers[0], 'Existing Grok');
  const preMigrationGrant = await authorize(customers[0], preMigrationClient);
  const originalJobFeedToken = await jobFeedToken(customers[0]);
  await stopBridge(runtime);
  runtime = null;

  runtime = await startBridge(publicBase);

  const unauthenticatedMcp = await fetch(`${localBase}${scopedPath(customers[0], '/mcp')}`);
  assert.equal(unauthenticatedMcp.status, 401);
  assert.match(unauthenticatedMcp.headers.get('www-authenticate') || '', new RegExp(`resource_metadata="${publicBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const protectedResource = await json(fetch(
    `${localBase}/.well-known/oauth-protected-resource${scopedPath(customers[0], '/mcp')}`
  ));
  assert.equal(protectedResource.response.status, 200, JSON.stringify(protectedResource.data));
  assert.equal(protectedResource.data.resource, `${publicBase}${scopedPath(customers[0], '/mcp')}`);
  assert.deepEqual(protectedResource.data.authorization_servers, [`${publicBase}${scopedPath(customers[0])}`]);

  const authorizationServer = await json(fetch(
    `${localBase}/.well-known/oauth-authorization-server${scopedPath(customers[0])}`
  ));
  assert.equal(authorizationServer.response.status, 200, JSON.stringify(authorizationServer.data));
  assert.equal(authorizationServer.data.issuer, `${publicBase}${scopedPath(customers[0])}`);
  assert.equal(authorizationServer.data.registration_endpoint, `${publicBase}${scopedPath(customers[0], '/register')}`);
  assert.equal(authorizationServer.data.authorization_endpoint, `${publicBase}${scopedPath(customers[0], '/authorize')}`);
  assert.equal(authorizationServer.data.token_endpoint, `${publicBase}${scopedPath(customers[0], '/token')}`);

  const oldCredentialInfo = await fetch(`${localBase}${scopedPath(customers[0], '/v1/info')}`, {
    headers: bearer(accessCode(customers[0]))
  });
  assert.equal(oldCredentialInfo.status, 200, await oldCredentialInfo.text());
  assert.equal(await jobFeedToken(customers[0]), originalJobFeedToken, 'derived job-feed credential must remain stable');

  const existingMcp = await initializeMcp(customers[0], preMigrationGrant.access_token);
  assert.equal(existingMcp.status, 200, await existingMcp.text());

  const refreshed = await json(fetch(`${localBase}${scopedPath(customers[0], '/token')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'refresh_token',
      refresh_token: preMigrationGrant.refresh_token,
      client_id: preMigrationClient.clientId
    })
  }));
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.data));
  assert.ok(refreshed.data.access_token);

  const clients = await json(fetch(`${localBase}${scopedPath(customers[0], '/v1/oauth/clients')}`, {
    headers: bearer(accessCode(customers[0]))
  }));
  assert.equal(clients.response.status, 200, JSON.stringify(clients.data));
  assert.equal(clients.data.count, 1, 'registered OAuth client must survive the issuer correction');

  const correctedClient = await register(customers[0], 'Corrected Grok');
  const correctedGrant = await authorize(customers[0], correctedClient);
  assert.equal((await initializeMcp(customers[0], correctedGrant.access_token)).status, 200);

  const crossedOauth = await initializeMcp(customers[1], correctedGrant.access_token);
  assert.equal(crossedOauth.status, 401, 'OAuth tokens must remain customer-isolated');
  const crossedCredential = await fetch(`${localBase}${scopedPath(customers[1], '/v1/info')}`, {
    headers: bearer(accessCode(customers[0]))
  });
  assert.equal(crossedCredential.status, 401, 'customer access codes must remain isolated');

  await stopBridge(runtime);
  runtime = await startBridge(publicBase);
  assert.equal((await initializeMcp(customers[0], preMigrationGrant.access_token)).status, 200,
    'migrated OAuth state must survive another HTTPS restart');
  assert.equal(await jobFeedToken(customers[0]), originalJobFeedToken);

  await stopBridge(runtime);
  runtime = null;
  process.env.MEMORY_BRIDGE_PUBLIC_URL = publicBase;
  const customerPath = scopedPath(customers[0]);
  const pinnedCredential = accessCode(customers[0]);
  assert.equal(transitionRestores(`${localBase}${customerPath}`, `${publicBase}${customerPath}`, pinnedCredential, 'allowed'), true);
  assert.equal(transitionRestores(`${publicBase}${customerPath}`, `${localBase}${customerPath}`, pinnedCredential, 'reverse'), false);
  assert.equal(transitionRestores(`http://192.0.2.10:8787${customerPath}`, `${publicBase}${customerPath}`, pinnedCredential, 'non-loopback'), false);
  assert.equal(transitionRestores(`http://localhost:${port}${customerPath}`, `${publicBase}${customerPath}`, pinnedCredential, 'unpinned-loopback'), false);
  assert.equal(transitionRestores(`${localBase}${customerPath}`, `https://unrelated.example${customerPath}`, pinnedCredential, 'unrelated-target'), false);
  assert.equal(transitionRestores(`${localBase}${customerPath}`, `${publicBase}${scopedPath(customers[1])}`, pinnedCredential, 'different-customer'), false);

  runtime = await startBridge(publicBase);
  const earlierHttpsCredential = accessCode(customers[0], 'https://earlier-bridge.example');
  const earlierCredentialResponse = await fetch(`${localBase}${scopedPath(customers[0], '/v1/info')}`, {
    headers: bearer(earlierHttpsCredential)
  });
  assert.equal(earlierCredentialResponse.status, 401,
    'an MSB2 credential from an earlier unpinned HTTPS origin is not preserved');

  console.log('PASS public URL migration: exact loopback-to-configured-HTTPS issuer transition only, DCR, authorization, token/refresh, pinned credentials, OAuth grants, job-feed credentials, and customer isolation.');
} finally {
  if (runtime) await stopBridge(runtime);
  delete process.env.MEMORY_BRIDGE_PUBLIC_URL;
  delete process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE;
  fs.rmSync(stateDir, { recursive: true, force: true });
}
