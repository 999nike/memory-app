import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = 22000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const publicBase = 'https://bridge.test';
const adminToken = `admin-${crypto.randomBytes(24).toString('base64url')}`;
const ownerToken = `retired-owner-${crypto.randomBytes(24).toString('base64url')}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-private-oauth-'));
const redirectHost = 'example.com';

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function form(body) {
  return new URLSearchParams(body);
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authorizeQuery(client, challenge, state = 'private-reconnect-test') {
  return new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'memory.read memory.propose',
    state
  });
}

const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  cwd: HERE,
  env: {
    ...process.env,
    MEMORY_BRIDGE_HOST: '127.0.0.1',
    MEMORY_BRIDGE_PORT: String(port),
    MEMORY_BRIDGE_TOKEN: ownerToken,
    MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
    MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
    MEMORY_BRIDGE_NAME: 'Private OAuth Reconnect Test Bridge',
    MEMORY_BRIDGE_MODEL: 'test-model',
    MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
    MEMORY_BRIDGE_PUBLIC_URL: publicBase,
    MEMORY_BRIDGE_OAUTH_CLIENT_ID: 'memory-space-grok',
    MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS: redirectHost,
    MEMORY_BRIDGE_ORIGINS: 'https://memory-app.example',
    MEMORY_BRIDGE_OAUTH_STATE_FILE: path.join(stateDir, 'legacy-oauth.enc.json'),
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
      const response = await fetch(`${base}/v1/info`, { headers: bearer(adminToken) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start\n${logs}`);
}

async function createConnection(name) {
  const response = await fetch(`${base}/v1/connections`, {
    method: 'POST',
    headers: { ...bearer(adminToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.match(data.accessCode, /^MSB2\./);
  return data;
}

async function registerClient(connection, clientName) {
  const redirectUri = `https://${redirectHost}/${encodeURIComponent(clientName.toLowerCase())}/callback`;
  const response = await fetch(`${base}/c/${encodeURIComponent(connection.connectionId)}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: clientName,
      application_type: 'web'
    })
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.match(data.client_id, /^memory-space-dcr-/);
  return { clientId: data.client_id, redirectUri };
}

async function authorize(connection, client) {
  const { verifier, challenge } = pkce();
  const query = authorizeQuery(client, challenge);
  const scopedPath = `/c/${encodeURIComponent(connection.connectionId)}`;

  const page = await fetch(`${base}${scopedPath}/authorize?${query}`);
  const html = await page.text();
  assert.equal(page.status, 200, html);
  assert.match(html, /Authorize external AI access/);
  assert.doesNotMatch(html, /Bridge pairing token/);
  assert.match(html, new RegExp(`${scopedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/authorize`));

  const approval = await fetch(`${base}${scopedPath}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'memory.read memory.propose',
      state: 'private-reconnect-test'
    })
  });

  if (approval.status !== 302) {
    return { approval, body: await approval.text(), verifier };
  }

  const location = approval.headers.get('location');
  assert.ok(location, 'authorization redirect must be returned');
  const code = new URL(location).searchParams.get('code');
  assert.ok(code, 'authorization code must be returned');

  const token = await fetch(`${base}${scopedPath}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      code_verifier: verifier
    })
  });
  const tokenData = await token.json();
  assert.equal(token.status, 200, JSON.stringify(tokenData));
  assert.ok(tokenData.access_token);
  assert.ok(tokenData.refresh_token);
  return { approval, tokenData };
}

try {
  await waitForBridge();

  const ownerPrivate = await createConnection('Owner Private');
  const plumberPrivate = await createConnection('Plumber Private');
  assert.notEqual(ownerPrivate.connectionId, plumberPrivate.connectionId);
  assert.notEqual(ownerPrivate.accessCode, plumberPrivate.accessCode);

  const ownerClient = await registerClient(ownerPrivate, 'Owner Claude');
  const plumberClient = await registerClient(plumberPrivate, 'Plumber Claude');

  // A client registered inside one customer's OAuth namespace must not become
  // valid merely by presenting it at another customer's private issuer.
  {
    const { challenge } = pkce();
    const wrongTenantQuery = authorizeQuery(ownerClient, challenge, 'wrong-tenant-test');
    const wrongTenantPage = await fetch(
      `${base}/c/${encodeURIComponent(plumberPrivate.connectionId)}/authorize?${wrongTenantQuery}`
    );
    const wrongTenantBody = await wrongTenantPage.text();
    assert.equal(wrongTenantPage.status, 400, wrongTenantBody);
    assert.match(wrongTenantBody, /Unknown OAuth client_id/);
  }

  // Legacy/root compatibility remains pairing-token gated. Only private MSB2
  // issuers use the simple Connect AI -> Authorize flow.
  {
    const { challenge } = pkce();
    const legacyQuery = new URLSearchParams({
      response_type: 'code',
      client_id: 'memory-space-grok',
      redirect_uri: `https://${redirectHost}/legacy/callback`,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'memory.read memory.propose',
      state: 'legacy-pairing-test'
    });
    const legacyPage = await fetch(`${base}/authorize?${legacyQuery}`);
    const legacyHtml = await legacyPage.text();
    assert.equal(legacyPage.status, 200, legacyHtml);
    assert.match(legacyHtml, /Bridge pairing token/);
  }

  const ownerGrant = await authorize(ownerPrivate, ownerClient);
  assert.equal(ownerGrant.approval.status, 302);

  const plumberGrant = await authorize(plumberPrivate, plumberClient);
  assert.equal(plumberGrant.approval.status, 302);

  const ownerClientsResponse = await fetch(`${base}/c/${encodeURIComponent(ownerPrivate.connectionId)}/v1/oauth/clients`, {
    headers: bearer(ownerPrivate.accessCode)
  });
  const ownerClients = await ownerClientsResponse.json();
  assert.equal(ownerClientsResponse.status, 200, JSON.stringify(ownerClients));
  assert.equal(ownerClients.count, 1);
  assert.equal(ownerClients.clients[0].clientName, 'Owner Claude');

  const plumberClientsResponse = await fetch(`${base}/c/${encodeURIComponent(plumberPrivate.connectionId)}/v1/oauth/clients`, {
    headers: bearer(plumberPrivate.accessCode)
  });
  const plumberClients = await plumberClientsResponse.json();
  assert.equal(plumberClientsResponse.status, 200, JSON.stringify(plumberClients));
  assert.equal(plumberClients.count, 1);
  assert.equal(plumberClients.clients[0].clientName, 'Plumber Claude');

  console.log('PASS private OAuth reconnect: Connect AI uses one scoped MCP handoff, private consent needs only Authorize, and owner/plumber OAuth namespaces remain isolated.');
} finally {
  child.kill('SIGTERM');
  fs.rmSync(stateDir, { recursive: true, force: true });
}
